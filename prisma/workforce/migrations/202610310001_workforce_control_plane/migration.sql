-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkforceCompany" (
    "id" UUID NOT NULL,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WorkforceCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkforceMember" (
    "companyId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WorkforceMember_pkey" PRIMARY KEY ("companyId","userId")
);

-- CreateTable
CREATE TABLE "WorkforceTask" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "correlationId" UUID NOT NULL,
    "department" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "digest" TEXT NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "approverId" TEXT,
    "approverVersion" INTEGER,
    "founderId" TEXT,
    "founderVersion" INTEGER,
    "approvalId" UUID,
    "approvalUntil" TIMESTAMPTZ(3),
    "approvalState" TEXT NOT NULL DEFAULT 'PENDING',
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "result" JSONB,

    CONSTRAINT "WorkforceTask_pkey" PRIMARY KEY ("companyId", "id")
);

-- CreateTable
CREATE TABLE "WorkforceReceipt" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "executorId" TEXT NOT NULL,
    "approvalId" UUID NOT NULL,
    "digest" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "WorkforceReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkforceAudit" (
    "id" BIGSERIAL NOT NULL,
    "companyId" UUID NOT NULL,
    "actorId" TEXT NOT NULL,
    "taskId" UUID,
    "action" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkforceAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_providerId_accountId_key" ON "Account"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimit_key_key" ON "RateLimit"("key");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceTask_companyId_id_key" ON "WorkforceTask"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceTask_companyId_correlationId_department_key" ON "WorkforceTask"("companyId", "correlationId", "department");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceReceipt_companyId_taskId_attempt_key" ON "WorkforceReceipt"("companyId", "taskId", "attempt");

-- CreateIndex
CREATE INDEX "WorkforceAudit_companyId_id_idx" ON "WorkforceAudit"("companyId", "id");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Separate database only. No customer models or customer auth identities.
CREATE SCHEMA wf_private;
REVOKE ALL ON SCHEMA wf_private FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA wf_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER TABLE "WorkforceMember" ADD FOREIGN KEY ("companyId") REFERENCES "WorkforceCompany"(id);
ALTER TABLE "WorkforceMember" ADD FOREIGN KEY ("userId") REFERENCES "User"(id);
ALTER TABLE "WorkforceMember" ADD CHECK (role IN ('REQUESTER','APPROVER','EXECUTOR','FOUNDER'));
ALTER TABLE "WorkforceTask" ADD FOREIGN KEY ("companyId","submittedBy") REFERENCES "WorkforceMember"("companyId","userId");
ALTER TABLE "WorkforceTask" ADD FOREIGN KEY ("companyId","approverId") REFERENCES "WorkforceMember"("companyId","userId");
ALTER TABLE "WorkforceTask" ADD FOREIGN KEY ("companyId","founderId") REFERENCES "WorkforceMember"("companyId","userId");
ALTER TABLE "WorkforceTask" ADD UNIQUE ("companyId",id,digest,"approvalId");
ALTER TABLE "WorkforceTask" ADD CHECK (department IN ('ENGINEERING','OPERATIONS'));
ALTER TABLE "WorkforceTask" ADD CHECK (status IN ('QUEUED','RUNNING','DRAFT_READY','RETRYABLE_FAILURE','FAILED','CANCELLED'));
ALTER TABLE "WorkforceTask" ADD CHECK ("approvalState" IN ('PENDING','APPROVED','REVOKED'));
ALTER TABLE "WorkforceTask" ADD CHECK (version >= 0 AND attempts BETWEEN 0 AND 3 AND digest ~ '^[a-f0-9]{64}$');
ALTER TABLE "WorkforceTask" ADD CHECK ("submittedBy" IS DISTINCT FROM "approverId" AND "submittedBy" IS DISTINCT FROM "founderId");
ALTER TABLE "WorkforceTask" ADD CHECK ("approverId" IS NULL OR "founderId" IS NULL OR "approverId" <> "founderId");
ALTER TABLE "WorkforceTask" ADD CHECK ("approvalState" <> 'APPROVED' OR ("approvalId" IS NOT NULL AND "approvalUntil" IS NOT NULL AND "approverId" IS NOT NULL AND "founderId" IS NOT NULL));
ALTER TABLE "WorkforceTask" ADD CHECK (status <> 'DRAFT_READY' OR result IS NOT NULL);
ALTER TABLE "WorkforceTask" ADD CHECK ("approvalState" <> 'REVOKED' OR (status = 'CANCELLED' AND result IS NULL));
ALTER TABLE "WorkforceReceipt" ADD FOREIGN KEY ("companyId","taskId",digest,"approvalId") REFERENCES "WorkforceTask"("companyId",id,digest,"approvalId");
ALTER TABLE "WorkforceReceipt" ADD FOREIGN KEY ("companyId","executorId") REFERENCES "WorkforceMember"("companyId","userId");
ALTER TABLE "WorkforceReceipt" ADD CHECK (attempt BETWEEN 1 AND 3 AND status IN ('CLAIMED','DRAFT_READY','RETRYABLE_FAILURE','FAILED','CANCELLED'));
ALTER TABLE "WorkforceAudit" ADD FOREIGN KEY ("companyId","actorId") REFERENCES "WorkforceMember"("companyId","userId");
ALTER TABLE "WorkforceAudit" ADD FOREIGN KEY ("companyId","taskId") REFERENCES "WorkforceTask"("companyId",id);
ALTER TABLE "WorkforceCompany" ADD CHECK (version >= 0);
ALTER TABLE "WorkforceMember" ADD CHECK (version >= 0);

-- Transaction stamp prevents session context reuse across pooled transactions.
-- Actor/session are installed only after Better Auth validation by the controller.
CREATE FUNCTION wf_private.visible(company uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
 SELECT current_setting('wf.transaction',true) = pg_current_xact_id()::text
 AND current_setting('wf.company',true) = company::text
 AND EXISTS (SELECT 1 FROM public."WorkforceMember" m JOIN public."User" u ON u.id=m."userId"
 JOIN public."Session" s ON s."userId"=u.id
 WHERE m."companyId"=company AND m."userId"=current_setting('wf.actor',true)
 AND m.active AND u."emailVerified" AND s.id=current_setting('wf.session',true) AND s."expiresAt">statement_timestamp())
$$;

DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['WorkforceCompany','WorkforceMember','WorkforceTask','WorkforceReceipt','WorkforceAudit'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',tab);
  -- Migration owner is a privileged provisioning authority. Runtime is never
  -- this owner or its member. Definer operations still explicitly authorize.
  EXECUTE format('CREATE POLICY migration_owner ON public.%I TO %I USING (true) WITH CHECK (true)',tab,current_user);
  EXECUTE format('CREATE POLICY scoped_read ON public.%I FOR SELECT USING (wf_private.visible(%I))',tab,CASE WHEN tab='WorkforceCompany' THEN 'id' ELSE 'companyId' END);
 END LOOP;
END $$;

CREATE FUNCTION wf_private.dispatch(op text, company uuid, data jsonb) RETURNS jsonb
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
 WHERE s.id=current_setting('wf.session',true) AND u.id=actor AND u."emailVerified" AND s."expiresAt">clock_timestamp() FOR SHARE OF s,u;
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
  INSERT INTO public."WorkforceAudit"("companyId","actorId",action,version) VALUES(company,actor,'member.disabled',(data->>'expectedVersion')::int+1);
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
    IF m.role<>'EXECUTOR' OR actor IN (t."submittedBy",t."approverId",t."founderId") THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
    IF t."approvalState"<>'APPROVED' OR t."approvalUntil"<=clock_timestamp() THEN RAISE EXCEPTION 'APPROVAL_REQUIRED' USING ERRCODE='42501'; END IF;
    PERFORM 1 FROM public."WorkforceMember" WHERE "companyId"=company AND "userId"=t."approverId" AND active AND role='APPROVER' AND version=t."approverVersion" FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'APPROVAL_REQUIRED' USING ERRCODE='42501'; END IF;
    PERFORM 1 FROM public."WorkforceMember" WHERE "companyId"=company AND "userId"=t."founderId" AND active AND role='FOUNDER' AND version=t."founderVersion" FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'APPROVAL_REQUIRED' USING ERRCODE='42501'; END IF;
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
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA wf_private FROM PUBLIC;
