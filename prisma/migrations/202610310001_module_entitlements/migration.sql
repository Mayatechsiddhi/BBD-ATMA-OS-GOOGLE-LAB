BEGIN;
CREATE TABLE "OrganizationModule" (
  "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "moduleId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("organizationId", "moduleId"),
  CONSTRAINT "OrganizationModule_known" CHECK ("moduleId" IN ('crm','clinic','atma','agents','workflows','marketing','industry')),
  CONSTRAINT "OrganizationModule_available" CHECK (NOT enabled OR "moduleId" IN ('crm','clinic')),
  CONSTRAINT "OrganizationModule_version" CHECK (version >= 0)
);
-- Additive backfill: preserve the two existing working modules. No future
-- catalog entries are granted automatically, and no business rows are changed.
INSERT INTO "OrganizationModule" ("organizationId","moduleId",enabled,"updatedAt")
SELECT o.id, m.id, true, CURRENT_TIMESTAMP FROM "Organization" o
CROSS JOIN (VALUES ('crm'),('clinic')) m(id);
ALTER TABLE "OrganizationModule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrganizationModule" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  EXECUTE format('CREATE POLICY migration_owner ON public."OrganizationModule" TO %I USING (true) WITH CHECK (true)',current_user);
END $$;
-- DISPLAY may read access flags only, so the authenticated calling stream can
-- check clinic entitlement. It gains no patient/contact/audit permissions.
CREATE POLICY tenant_read ON "OrganizationModule" FOR SELECT USING (
  "organizationId"=bbd_private.organization_id() AND
  bbd_private.membership_role("organizationId") IN ('OWNER','ADMIN','MEMBER','DISPLAY')
);
CREATE POLICY tenant_insert ON "OrganizationModule" FOR INSERT WITH CHECK (
  "organizationId"=bbd_private.organization_id() AND bbd_private.membership_role("organizationId")='OWNER'
);
CREATE POLICY tenant_update ON "OrganizationModule" FOR UPDATE USING (
  "organizationId"=bbd_private.organization_id() AND bbd_private.membership_role("organizationId")='OWNER'
) WITH CHECK (
  "organizationId"=bbd_private.organization_id() AND bbd_private.membership_role("organizationId")='OWNER'
);
COMMIT;
