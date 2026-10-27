BEGIN;
CREATE TYPE "ClinicLeadStatus" AS ENUM ('NEW','CONTACTED','QUALIFIED','CONVERTED','LOST');
CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED','CONFIRMED','CHECKED_IN','COMPLETED','CANCELLED','NO_SHOW');
CREATE TYPE "FollowUpStatus" AS ENUM ('OPEN','DONE','CANCELLED');
CREATE TABLE "ClinicLead" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE ON UPDATE CASCADE,
 "name" TEXT NOT NULL, "phone" TEXT NOT NULL, "email" TEXT, "source" TEXT NOT NULL,
 "status" "ClinicLeadStatus" NOT NULL DEFAULT 'NEW',
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "ClinicLead_source" CHECK (source IN ('PHONE','WALK_IN','WEBSITE','REFERRAL','OTHER'))
);
CREATE UNIQUE INDEX "ClinicLead_organizationId_id_key" ON "ClinicLead"("organizationId",id);
CREATE INDEX "ClinicLead_organizationId_status_createdAt_idx" ON "ClinicLead"("organizationId",status,"createdAt");
CREATE INDEX "ClinicLead_organizationId_phone_idx" ON "ClinicLead"("organizationId",phone);
CREATE TABLE "Appointment" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE ON UPDATE CASCADE,
 "leadId" TEXT NOT NULL, "resource" TEXT NOT NULL,
 "startsAt" TIMESTAMPTZ(3) NOT NULL, "endsAt" TIMESTAMPTZ(3) NOT NULL,
 "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "Appointment_lead_tenant_fkey" FOREIGN KEY ("organizationId","leadId") REFERENCES "ClinicLead"("organizationId",id) ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "Appointment_interval" CHECK ("endsAt" > "startsAt" AND "endsAt" <= "startsAt" + INTERVAL '8 hours'),
 CONSTRAINT "Appointment_resource" CHECK (length(resource) BETWEEN 2 AND 80 AND resource = lower(btrim(resource)))
);
CREATE UNIQUE INDEX "Appointment_organizationId_id_key" ON "Appointment"("organizationId",id);
CREATE INDEX "Appointment_organizationId_startsAt_idx" ON "Appointment"("organizationId","startsAt");
CREATE INDEX "Appointment_organizationId_resource_startsAt_idx" ON "Appointment"("organizationId",resource,"startsAt");
CREATE TABLE "FollowUp" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE ON UPDATE CASCADE,
 "leadId" TEXT NOT NULL, "title" TEXT NOT NULL, "dueAt" TIMESTAMPTZ(3) NOT NULL,
 "status" "FollowUpStatus" NOT NULL DEFAULT 'OPEN', "completedAt" TIMESTAMPTZ(3),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "FollowUp_lead_tenant_fkey" FOREIGN KEY ("organizationId","leadId") REFERENCES "ClinicLead"("organizationId",id) ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "FollowUp_completion" CHECK ((status = 'DONE') = ("completedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "FollowUp_organizationId_id_key" ON "FollowUp"("organizationId",id);
CREATE INDEX "FollowUp_organizationId_status_dueAt_idx" ON "FollowUp"("organizationId",status,"dueAt");
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['ClinicLead','Appointment','FollowUp'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY migration_owner ON public.%I TO %I USING (true) WITH CHECK (true)',t,current_user);
  EXECUTE format('CREATE POLICY tenant_read ON public.%I FOR SELECT USING ("organizationId" = bbd_private.organization_id() AND bbd_private.membership_role("organizationId") IS NOT NULL)',t);
  EXECUTE format('CREATE POLICY tenant_insert ON public.%I FOR INSERT WITH CHECK ("organizationId" = bbd_private.organization_id() AND bbd_private.membership_role("organizationId") IN (''OWNER'',''ADMIN''))',t);
  EXECUTE format('CREATE POLICY tenant_update ON public.%I FOR UPDATE USING ("organizationId" = bbd_private.organization_id() AND bbd_private.membership_role("organizationId") IN (''OWNER'',''ADMIN'')) WITH CHECK ("organizationId" = bbd_private.organization_id() AND bbd_private.membership_role("organizationId") IN (''OWNER'',''ADMIN''))',t);
 END LOOP;
END $$;
COMMIT;
