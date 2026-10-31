-- Additive correction to the existing enclave; no customer tables or new DB.
BEGIN;
ALTER TABLE public."WorkforceAudit" ADD COLUMN "subjectUserId" text;
ALTER TABLE public."WorkforceAudit" ADD CONSTRAINT workforce_audit_subject_fk
 FOREIGN KEY ("companyId","subjectUserId") REFERENCES public."WorkforceMember"("companyId","userId");
-- Old unattributed events remain historical evidence. Enforce attribution for
-- new member-disable rows without inventing or rewriting old subjects.
ALTER TABLE public."WorkforceAudit" ADD CONSTRAINT workforce_audit_member_subject
 CHECK (action <> 'member.disabled' OR "subjectUserId" IS NOT NULL) NOT VALID;

CREATE OR REPLACE FUNCTION wf_private.visible(company uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
 SELECT current_setting('wf.transaction',true) = pg_current_xact_id()::text
 AND current_setting('wf.company',true) = company::text
 AND EXISTS (SELECT 1 FROM public."WorkforceMember" m JOIN public."User" u ON u.id=m."userId"
 JOIN public."Session" s ON s."userId"=u.id
 WHERE m."companyId"=company AND m."userId"=current_setting('wf.actor',true)
 AND m.active AND u."emailVerified" AND s.id=current_setting('wf.session',true) AND (s."expiresAt" AT TIME ZONE 'UTC')>statement_timestamp())
$$;

CREATE OR REPLACE FUNCTION wf_private.dispatch(op text, company uuid, data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text := current_setting('wf.actor',true);
 m public."WorkforceMember"; t public."WorkforceTask"; receipt public."WorkforceReceipt";
 c public."WorkforceCompany"; req jsonb; digest_value text; event text; out jsonb;
BEGIN
 IF jsonb_typeof(data)<>'object' OR octet_length(data::text)>6000 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 IF current_setting('wf.transaction',true) IS DISTINCT FROM pg_current_xact_id()::text
 OR current_setting('wf.company',true) IS DISTINCT FROM company::text THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 -- Company lock precedes fresh authorization, serializing workers, approval,
 -- pause and membership revocation. No lock/transaction spans adapter work.
 PERFORM pg_advisory_xact_lock(hashtextextended(company::text,71));
 PERFORM 1 FROM public."Session" s JOIN public."User" u ON u.id=s."userId"
 WHERE s.id=current_setting('wf.session',true) AND u.id=actor AND u."emailVerified" AND (s."expiresAt" AT TIME ZONE 'UTC')>clock_timestamp() FOR SHARE OF s,u;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM public."WorkforceMember" WHERE "companyId"=company AND "userId"=actor AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public."WorkforceCompany" WHERE id=company FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;

 IF op='audit' THEN
  IF m.role NOT IN ('APPROVER','FOUNDER') OR data <> '{}' THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM (SELECT * FROM public."WorkforceAudit" WHERE "companyId"=company ORDER BY id DESC LIMIT 100) a),'[]');
 END IF;
 IF op IN ('pause','resume') THEN
  IF m.role<>'FOUNDER' OR data - 'expectedVersion' <> '{}' THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
  IF c.version IS DISTINCT FROM (data->>'expectedVersion')::int THEN RAISE EXCEPTION 'CONFLICT' USING ERRCODE='40001'; END IF;
  UPDATE public."WorkforceCompany" SET paused=(op='pause'),version=version+1 WHERE id=company RETURNING * INTO c;
  INSERT INTO public."WorkforceAudit"("companyId","actorId",action,version) VALUES(company,actor,'company.'||op,c.version);
  RETURN to_jsonb(c);
 END IF;
 IF op='disable-member' THEN
  IF m.role<>'FOUNDER' OR data - ARRAY['userId','expectedVersion'] <> '{}' THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
  UPDATE public."WorkforceMember" SET active=false,version=version+1 WHERE "companyId"=company AND "userId"=data->>'userId' AND role<>'FOUNDER' AND active AND version=(data->>'expectedVersion')::int;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONFLICT' USING ERRCODE='40001'; END IF;
  INSERT INTO public."WorkforceAudit"("companyId","actorId","subjectUserId",action,version) VALUES(company,actor,data->>'userId','member.disabled',(data->>'expectedVersion')::int+1);
  RETURN jsonb_build_object('disabled',true);
 END IF;

 IF op='submit' THEN
  IF m.role<>'REQUESTER' OR data - ARRAY['request','digest'] <> '{}' THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
  req:=data->'request'; digest_value:=data->>'digest';
  IF jsonb_typeof(req)<>'object' OR req->>'schema'<>'bbd.workforce.draft.requested.v1'
  OR req#>>'{scope,companyId}'<>company::text OR req#>>'{scope,kind}'<>'bbd-internal-only'
  OR req->>'department' NOT IN ('ENGINEERING','OPERATIONS') OR req->>'approvalState'<>'PENDING' OR req->>'executionStatus'<>'QUEUED'
  OR digest_value !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  SELECT * INTO t FROM public."WorkforceTask" WHERE id=(req->>'taskId')::uuid AND "companyId"=company;
  IF FOUND THEN
   IF t."submittedBy"<>actor OR t.digest<>digest_value OR t.request<>req THEN RAISE EXCEPTION 'CONFLICT' USING ERRCODE='40001'; END IF;
   RETURN to_jsonb(t);
  END IF;
  IF c.paused THEN RAISE EXCEPTION 'PAUSED' USING ERRCODE='42501'; END IF;
  IF (req->>'createdAt')::timestamptz>clock_timestamp() OR (req->>'expiresAt')::timestamptz<=clock_timestamp()
   OR (req->>'expiresAt')::timestamptz-(req->>'createdAt')::timestamptz>interval '15 minutes'
   OR (req#>>'{limits,maxAttempts}')::int NOT BETWEEN 1 AND 3 OR req#>>'{limits,maxSpendUsdCents}'<>'0' THEN RAISE EXCEPTION 'EXPIRED' USING ERRCODE='42501'; END IF;
  INSERT INTO public."WorkforceTask"(id,"companyId","correlationId",department,request,digest,"submittedBy","expiresAt")
   VALUES((req->>'taskId')::uuid,company,(req->>'correlationId')::uuid,req->>'department',req,digest_value,actor,(req->>'expiresAt')::timestamptz) RETURNING * INTO t;
  event:='task.submitted';
 ELSE
  IF data - ARRAY['taskId','expectedVersion','requestDigest','receiptId','result','outcome'] <> '{}' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  SELECT * INTO t FROM public."WorkforceTask" WHERE "companyId"=company AND id=(data->>'taskId')::uuid FOR UPDATE;
  IF NOT FOUND OR (m.role='REQUESTER' AND t."submittedBy"<>actor) THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
  IF op='read' THEN RETURN to_jsonb(t) || jsonb_build_object('receipts',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY attempt) FROM public."WorkforceReceipt" r WHERE r."companyId"=company AND r."taskId"=t.id),'[]')); END IF;
  IF t.version IS DISTINCT FROM (data->>'expectedVersion')::int OR t.digest IS DISTINCT FROM data->>'requestDigest' THEN RAISE EXCEPTION 'CONFLICT' USING ERRCODE='40001'; END IF;
  -- The same live consent gate protects input admission, claims, finish and
  -- retry. Reject before any adapter computation, not merely on publication.
  IF op IN ('execution-input','claim','finish','retry') THEN
   IF c.paused THEN RAISE EXCEPTION 'PAUSED' USING ERRCODE='42501'; END IF;
   IF t."expiresAt"<=clock_timestamp() THEN RAISE EXCEPTION 'EXPIRED' USING ERRCODE='42501'; END IF;
    IF m.role<>'EXECUTOR' OR actor IN (t."submittedBy",t."approverId",t."founderId") THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
    IF t."approvalState"<>'APPROVED' OR t."approvalUntil"<=clock_timestamp() THEN RAISE EXCEPTION 'APPROVAL_REQUIRED' USING ERRCODE='42501'; END IF;
    PERFORM 1 FROM public."WorkforceMember" WHERE "companyId"=company AND "userId"=t."approverId" AND active AND role='APPROVER' AND version=t."approverVersion" FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'APPROVAL_REQUIRED' USING ERRCODE='42501'; END IF;
    PERFORM 1 FROM public."WorkforceMember" WHERE "companyId"=company AND "userId"=t."founderId" AND active AND role='FOUNDER' AND version=t."founderVersion" FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'APPROVAL_REQUIRED' USING ERRCODE='42501'; END IF;
  END IF;
  IF op='execution-input' THEN
   IF m.role<>'EXECUTOR' OR t.status<>'RUNNING' OR c.paused OR t."expiresAt"<=clock_timestamp() OR t."approvalState"<>'APPROVED' OR t."approvalUntil"<=clock_timestamp()
    OR NOT EXISTS (SELECT 1 FROM public."WorkforceReceipt" r WHERE r.id=(data->>'receiptId')::uuid AND r."companyId"=company AND r."taskId"=t.id AND r."executorId"=actor AND r.status='CLAIMED')
    THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
   RETURN to_jsonb(t);
  END IF;
  IF op='revoke' THEN
   IF NOT (m.role='FOUNDER' OR (m.role='APPROVER' AND t."approverId"=actor)) THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
   IF t."approvalState"='REVOKED' THEN RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE='42501'; END IF;
   UPDATE public."WorkforceTask" SET "approvalState"='REVOKED',status='CANCELLED',result=NULL,version=version+1 WHERE id=t.id AND "companyId"=company RETURNING * INTO t;
   UPDATE public."WorkforceReceipt" SET status='CANCELLED',"finishedAt"=clock_timestamp() WHERE "companyId"=company AND "taskId"=t.id AND status IN ('CLAIMED','DRAFT_READY');
   event:='task.revoked';
  ELSE
   IF c.paused THEN RAISE EXCEPTION 'PAUSED' USING ERRCODE='42501'; END IF;
   IF t."expiresAt"<=clock_timestamp() THEN RAISE EXCEPTION 'EXPIRED' USING ERRCODE='42501'; END IF;
   IF op='approve' THEN
    IF m.role<>'APPROVER' OR actor=t."submittedBy" THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
    IF t.status<>'QUEUED' OR t."approvalState"<>'PENDING' OR t."approverId" IS NOT NULL THEN RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE='42501'; END IF;
    UPDATE public."WorkforceTask" SET "approverId"=actor,"approverVersion"=m.version,version=version+1 WHERE id=t.id AND "companyId"=company RETURNING * INTO t;
    event:='task.approver-consent';
   ELSIF op='founder-approve' THEN
    IF m.role<>'FOUNDER' OR actor=t."submittedBy" OR actor=t."approverId" THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
    IF t.status<>'QUEUED' OR t."approvalState"<>'PENDING' OR t."approverId" IS NULL THEN RAISE EXCEPTION 'APPROVAL_REQUIRED' USING ERRCODE='42501'; END IF;
    PERFORM 1 FROM public."WorkforceMember" WHERE "companyId"=company AND "userId"=t."approverId" AND active AND role='APPROVER' AND version=t."approverVersion" FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'APPROVAL_REQUIRED' USING ERRCODE='42501'; END IF;
    UPDATE public."WorkforceTask" SET "founderId"=actor,"founderVersion"=m.version,"approvalId"=gen_random_uuid(),"approvalUntil"=least("expiresAt",clock_timestamp()+interval '5 minutes'),"approvalState"='APPROVED',version=version+1 WHERE id=t.id AND "companyId"=company RETURNING * INTO t;
    event:='task.founder-consent';
   ELSIF op IN ('claim','finish','retry') THEN
    IF op='claim' THEN
     IF t.status<>'QUEUED' OR t.attempts >= (t.request#>>'{limits,maxAttempts}')::int THEN RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE='42501'; END IF;
     UPDATE public."WorkforceTask" SET status='RUNNING',attempts=attempts+1,version=version+1 WHERE id=t.id AND "companyId"=company RETURNING * INTO t;
     INSERT INTO public."WorkforceReceipt"(id,"companyId","taskId",attempt,"executorId","approvalId",digest,status) VALUES(gen_random_uuid(),company,t.id,t.attempts,actor,t."approvalId",t.digest,'CLAIMED') RETURNING * INTO receipt;
     event:='task.claimed';
    ELSIF op='retry' THEN
     IF t.status<>'RETRYABLE_FAILURE' OR t.attempts >= (t.request#>>'{limits,maxAttempts}')::int THEN RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE='42501'; END IF;
     UPDATE public."WorkforceTask" SET status='QUEUED',version=version+1 WHERE id=t.id AND "companyId"=company RETURNING * INTO t;
     event:='task.retry-requested';
    ELSE
     SELECT * INTO receipt FROM public."WorkforceReceipt" WHERE id=(data->>'receiptId')::uuid AND "companyId"=company AND "taskId"=t.id AND "executorId"=actor AND status='CLAIMED' FOR UPDATE;
     IF NOT FOUND OR t.status<>'RUNNING' OR receipt.attempt<>t.attempts OR receipt.digest<>t.digest OR receipt."approvalId"<>t."approvalId" THEN RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE='42501'; END IF;
     IF data->>'outcome' NOT IN ('DRAFT_READY','RETRYABLE_FAILURE','FAILED') THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
     IF data->>'outcome'='DRAFT_READY' AND (jsonb_typeof(data->'result')<>'object' OR data#>>'{result,taskId}'<>t.id::text OR data#>>'{result,scope,companyId}'<>company::text OR data#>>'{result,requestDigest}'<>t.digest OR data#>>'{result,approvalId}'<>t."approvalId"::text OR data#>>'{result,mock}'<>'true' OR data#>>'{result,requiresHumanReview}'<>'true') THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
     UPDATE public."WorkforceTask" SET status=CASE WHEN data->>'outcome'='RETRYABLE_FAILURE' AND attempts >= (request#>>'{limits,maxAttempts}')::int THEN 'FAILED' ELSE data->>'outcome' END,result=CASE WHEN data->>'outcome'='DRAFT_READY' THEN data->'result' ELSE NULL END,version=version+1 WHERE id=t.id AND "companyId"=company RETURNING * INTO t;
     UPDATE public."WorkforceReceipt" SET status=t.status,"finishedAt"=clock_timestamp() WHERE id=receipt.id RETURNING * INTO receipt;
     event:='task.'||lower(t.status);
    END IF;
   ELSE RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE='42501'; END IF;
  END IF;
 END IF;
 INSERT INTO public."WorkforceAudit"("companyId","actorId","taskId",action,version) VALUES(company,actor,t.id,event,t.version);
 RETURN to_jsonb(t) || jsonb_build_object('receipt',to_jsonb(receipt));
END $$;
-- CREATE OR REPLACE retains the existing reviewed owner/ACLs. Do not widen
-- runtime grants or create a second authorization path.
COMMIT;
