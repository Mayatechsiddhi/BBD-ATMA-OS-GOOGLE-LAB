-- Closed synthetic payload checks apply even to direct runtime SQL calls.
CREATE FUNCTION wf_private.valid_request(r jsonb, company uuid) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $body$
 SELECT coalesce(jsonb_typeof(r)='object' AND octet_length(r::text)<=6000 AND r ?& ARRAY['schema','taskId','correlationId','scope','department','taskKind','source','inputArtifact','outputKind','approvalState','executionStatus','createdAt','expiresAt','limits'] AND r - ARRAY['schema','taskId','correlationId','scope','department','taskKind','source','inputArtifact','outputKind','approvalState','executionStatus','createdAt','expiresAt','limits'] = '{}'
 AND r->>'schema'='bbd.workforce.draft.requested.v1'
 AND r->>'taskId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
 AND r->>'correlationId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
 AND r->'scope'=jsonb_build_object('kind','bbd-internal-only','companyId',company::text)
 AND r->'source'=jsonb_build_object('kind','synthetic-repository-metadata','repository','bloomdigital369-hue/BBD-MASTER-ATMA-OS','commit','c453ed0b452ab3c9b6e5575fadc2e04d402fa0a2')
 AND ((r->>'department'='ENGINEERING' AND r->>'taskKind'='review-summary' AND r->>'inputArtifact'='sha256:79298c52b49ec5ce769cb4fd6c0677966af3dde760e7ed670c04b68d45645f28')
 OR (r->>'department'='OPERATIONS' AND r->>'taskKind'='readiness-checklist' AND r->>'inputArtifact'='sha256:5abb21b3dedd6923a54f7c4095f07dcedfcfeeaf09aa6b2c36265e3aabd9739c'))
 AND r->>'outputKind'='markdown-draft' AND r->>'approvalState'='PENDING' AND r->>'executionStatus'='QUEUED'
 AND r->>'createdAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' AND r->>'expiresAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$'
 AND jsonb_typeof(r->'limits')='object' AND r->'limits' ?& ARRAY['maxAttempts','maxRunSeconds','maxSpendUsdCents'] AND (r->'limits')-ARRAY['maxAttempts','maxRunSeconds','maxSpendUsdCents']='{}'
 AND r#>'{limits,maxAttempts}' IN ('1'::jsonb,'2'::jsonb,'3'::jsonb) AND r#>'{limits,maxSpendUsdCents}'='0'::jsonb
 AND jsonb_typeof(r#>'{limits,maxRunSeconds}')='number' AND r#>>'{limits,maxRunSeconds}' ~ '^([1-9]|[1-9][0-9]|[12][0-9][0-9]|300)$',false)
$body$;
ALTER TABLE "WorkforceTask" ADD CONSTRAINT closed_request CHECK (wf_private.valid_request(request,"companyId") AND request->>'taskId'=id::text AND request->>'correlationId'="correlationId"::text AND request->>'department'=department);
CREATE FUNCTION wf_private.valid_result(r jsonb, request jsonb, digest text, approval uuid, attempt integer) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $body$
 SELECT coalesce(jsonb_typeof(r)='object' AND r ?& ARRAY['schema','taskId','correlationId','scope','department','sourceCommit','requestDigest','approvalId','approvalState','executionStatus','attempt','mock','requiresHumanReview','artifact'] AND r - ARRAY['schema','taskId','correlationId','scope','department','sourceCommit','requestDigest','approvalId','approvalState','executionStatus','attempt','mock','requiresHumanReview','artifact']='{}'
 AND r->>'schema'='bbd.workforce.draft.result.v1' AND r->>'taskId'=request->>'taskId' AND r->>'correlationId'=request->>'correlationId'
 AND r->'scope'=request->'scope' AND r->>'department'=request->>'department' AND r->>'sourceCommit'='c453ed0b452ab3c9b6e5575fadc2e04d402fa0a2'
 AND r->>'requestDigest'=digest AND r->>'approvalId'=approval::text AND r->>'approvalState'='APPROVED' AND r->>'executionStatus'='DRAFT_READY'
 AND r->'attempt'=to_jsonb(attempt) AND r->'mock'='true'::jsonb AND r->'requiresHumanReview'='true'::jsonb
 AND r->'artifact' ?& ARRAY['kind','content','digest'] AND (r->'artifact')-ARRAY['kind','content','digest']='{}'
 AND r#>>'{artifact,kind}'='markdown-draft' AND r#>>'{artifact,content}'=CASE request->>'department' WHEN 'ENGINEERING' THEN '# Synthetic Engineering draft

Mock review only. Review the synthetic diff and verify regression coverage. No repository was read or changed. Human review required.' ELSE '# Synthetic Operations draft

Mock readiness checklist only. Verify the synthetic build evidence and review the rollback plan. No infrastructure was inspected or changed. Human review required.' END
 AND r#>>'{artifact,digest}'=encode(sha256(convert_to(r#>>'{artifact,content}','UTF8')),'hex'),false)
$body$;
ALTER TABLE "WorkforceTask" ADD CONSTRAINT closed_result CHECK (status<>'DRAFT_READY' OR wf_private.valid_result(result,request,digest,"approvalId",attempts));
REVOKE ALL ON FUNCTION wf_private.valid_request(jsonb,uuid),wf_private.valid_result(jsonb,jsonb,text,uuid,integer) FROM PUBLIC;
