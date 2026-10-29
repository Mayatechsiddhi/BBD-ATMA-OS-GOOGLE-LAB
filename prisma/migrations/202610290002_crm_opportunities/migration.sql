BEGIN;
CREATE TABLE "Opportunity" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE ON UPDATE CASCADE,
 "contactId" TEXT NOT NULL, "title" TEXT NOT NULL, "amountPaise" INTEGER NOT NULL,
 "stage" TEXT NOT NULL DEFAULT 'OPEN', "version" INTEGER NOT NULL DEFAULT 0, "requestKey" UUID NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "Opportunity_contact_tenant_fkey" FOREIGN KEY ("organizationId","contactId") REFERENCES "Contact"("organizationId",id) ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "Opportunity_amount" CHECK ("amountPaise" BETWEEN 0 AND 1000000000),
 CONSTRAINT "Opportunity_title" CHECK (length(title) BETWEEN 2 AND 160),
 CONSTRAINT "Opportunity_stage" CHECK (stage IN ('OPEN','PROPOSAL','WON','LOST')),
 CONSTRAINT "Opportunity_version" CHECK (version >= 0)
);
CREATE UNIQUE INDEX "Opportunity_organizationId_id_key" ON "Opportunity"("organizationId",id);
CREATE UNIQUE INDEX "Opportunity_organizationId_requestKey_key" ON "Opportunity"("organizationId","requestKey");
CREATE INDEX "Opportunity_organizationId_stage_createdAt_id_idx" ON "Opportunity"("organizationId",stage,"createdAt",id);
ALTER TABLE "Opportunity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Opportunity" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 EXECUTE format('CREATE POLICY migration_owner ON public."Opportunity" TO %I USING (true) WITH CHECK (true)',current_user);
END $$;
CREATE POLICY tenant_read ON "Opportunity" FOR SELECT USING ("organizationId"=bbd_private.organization_id() AND bbd_private.membership_role("organizationId") IN ('OWNER','ADMIN','MEMBER'));
CREATE POLICY tenant_insert ON "Opportunity" FOR INSERT WITH CHECK ("organizationId"=bbd_private.organization_id() AND bbd_private.membership_role("organizationId") IN ('OWNER','ADMIN'));
CREATE POLICY tenant_update ON "Opportunity" FOR UPDATE USING ("organizationId"=bbd_private.organization_id() AND bbd_private.membership_role("organizationId") IN ('OWNER','ADMIN')) WITH CHECK ("organizationId"=bbd_private.organization_id() AND bbd_private.membership_role("organizationId") IN ('OWNER','ADMIN'));
COMMIT;
