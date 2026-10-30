BEGIN;
CREATE TABLE "OutboxEvent" (
  id UUID PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  sequence BIGINT NOT NULL CHECK (sequence > 0),
  "eventType" TEXT NOT NULL CHECK ("eventType"='crm.opportunity.created'),
  "schemaVersion" INTEGER NOT NULL CHECK ("schemaVersion"=1),
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "opportunityId" TEXT NOT NULL,
  payload JSONB NOT NULL,
  CONSTRAINT "OutboxEvent_opportunity_tenant_fkey" FOREIGN KEY ("organizationId","opportunityId") REFERENCES "Opportunity"("organizationId",id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OutboxEvent_safe_payload" CHECK (payload = jsonb_build_object('opportunityId',"opportunityId") AND octet_length(payload::text) <= 1024)
);
CREATE UNIQUE INDEX "OutboxEvent_organizationId_id_key" ON "OutboxEvent"("organizationId",id);
CREATE UNIQUE INDEX "OutboxEvent_organizationId_sequence_key" ON "OutboxEvent"("organizationId",sequence);
CREATE UNIQUE INDEX "OutboxEvent_semantic_key" ON "OutboxEvent"("organizationId","eventType","opportunityId","schemaVersion");
ALTER TABLE "OutboxEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OutboxEvent" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  EXECUTE format('CREATE POLICY migration_owner ON public."OutboxEvent" TO %I USING (true) WITH CHECK (true)',current_user);
END $$;
CREATE POLICY tenant_read ON "OutboxEvent" FOR SELECT USING (
  "organizationId"=bbd_private.organization_id() AND bbd_private.membership_role("organizationId") IN ('OWNER','ADMIN')
);
CREATE POLICY tenant_insert ON "OutboxEvent" FOR INSERT WITH CHECK (
  "organizationId"=bbd_private.organization_id() AND bbd_private.membership_role("organizationId") IN ('OWNER','ADMIN')
);
COMMIT;
