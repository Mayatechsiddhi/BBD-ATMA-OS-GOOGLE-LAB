BEGIN;
ALTER TABLE "Invitation" DROP CONSTRAINT "Invitation_non_owner_role";
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_non_owner_role" CHECK (role::text IN ('ADMIN','MEMBER','DISPLAY'));
ALTER POLICY membership_read ON "Membership" USING (
 (bbd_private.organization_id() IS NULL AND "userId"=bbd_private.actor_id()) OR
 ("organizationId"=bbd_private.organization_id() AND bbd_private.membership_role("organizationId") IN ('OWNER','ADMIN','MEMBER'))
);
ALTER POLICY audit_read ON "AuditEvent" USING ("organizationId"=bbd_private.organization_id() AND bbd_private.membership_role("organizationId") IN ('OWNER','ADMIN','MEMBER'));
ALTER POLICY contact_read ON "Contact" USING ("organizationId"=bbd_private.organization_id() AND bbd_private.membership_role("organizationId") IN ('OWNER','ADMIN','MEMBER'));
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['ClinicLead','Appointment','FollowUp'] LOOP
  EXECUTE format('ALTER POLICY tenant_read ON public.%I USING ("organizationId"=bbd_private.organization_id() AND bbd_private.membership_role("organizationId") IN (''OWNER'',''ADMIN'',''MEMBER''))',t);
 END LOOP;
END $$;
CREATE TABLE "Patient" (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE ON UPDATE CASCADE,
 "leadId" TEXT NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("organizationId","leadId") REFERENCES "ClinicLead"("organizationId",id) ON DELETE CASCADE ON UPDATE CASCADE,
 UNIQUE ("organizationId","leadId"), UNIQUE ("organizationId",id), UNIQUE ("organizationId",id,"leadId")
);
CREATE TABLE "Doctor" (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE ON UPDATE CASCADE,
 name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 100), room TEXT NOT NULL CHECK (length(room) BETWEEN 1 AND 40),
 revision INT NOT NULL DEFAULT 0 CHECK (revision>=0),
 resource TEXT NOT NULL CHECK (length(resource) BETWEEN 2 AND 80 AND resource=lower(btrim(resource))),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 UNIQUE ("organizationId",id), UNIQUE ("organizationId",resource)
);
CREATE UNIQUE INDEX "Appointment_organizationId_id_leadId_key" ON "Appointment"("organizationId",id,"leadId");
CREATE TYPE "QueueStatus" AS ENUM ('WAITING','CALLED','SKIPPED','COMPLETED','CANCELLED');
CREATE TABLE "QueueToken" (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE ON UPDATE CASCADE,
 "patientId" TEXT NOT NULL, "leadId" TEXT NOT NULL, "doctorId" TEXT NOT NULL, "appointmentId" TEXT,
 day TEXT NOT NULL CHECK (day ~ '^\d{4}-\d{2}-\d{2}$'), number INT NOT NULL CHECK (number BETWEEN 1 AND 99999),
 status "QueueStatus" NOT NULL DEFAULT 'WAITING', "callCount" INT NOT NULL DEFAULT 0 CHECK ("callCount">=0),
 "calledAt" TIMESTAMPTZ(3), "completedAt" TIMESTAMPTZ(3),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 FOREIGN KEY ("organizationId","patientId","leadId") REFERENCES "Patient"("organizationId",id,"leadId") ON DELETE CASCADE ON UPDATE CASCADE,
 FOREIGN KEY ("organizationId","doctorId") REFERENCES "Doctor"("organizationId",id) ON DELETE CASCADE ON UPDATE CASCADE,
 FOREIGN KEY ("organizationId","appointmentId","leadId") REFERENCES "Appointment"("organizationId",id,"leadId") ON DELETE CASCADE ON UPDATE CASCADE,
 UNIQUE ("organizationId",id), UNIQUE ("organizationId","appointmentId"), UNIQUE ("organizationId","appointmentId","leadId"), UNIQUE ("organizationId",day,number),
 UNIQUE ("organizationId",day,"doctorId","patientId"),
 CHECK (status <> 'CALLED' OR ("calledAt" IS NOT NULL AND "callCount">0)),
 CHECK ((status='COMPLETED')=("completedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "QueueToken_one_called_per_doctor_day" ON "QueueToken"("organizationId","doctorId",day) WHERE status='CALLED';
CREATE INDEX "QueueToken_organizationId_day_doctorId_status_number_idx" ON "QueueToken"("organizationId",day,"doctorId",status,number);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['Patient','Doctor','QueueToken'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY migration_owner ON public.%I TO %I USING (true) WITH CHECK (true)',t,current_user);
  EXECUTE format('CREATE POLICY tenant_read ON public.%I FOR SELECT USING ("organizationId"=bbd_private.organization_id() AND bbd_private.membership_role("organizationId") IN (''OWNER'',''ADMIN'',''MEMBER''%s))',t,CASE WHEN t='Patient' THEN '' ELSE ',''DISPLAY''' END);
  EXECUTE format('CREATE POLICY tenant_insert ON public.%I FOR INSERT WITH CHECK ("organizationId"=bbd_private.organization_id() AND bbd_private.membership_role("organizationId") IN (''OWNER'',''ADMIN''))',t);
  EXECUTE format('CREATE POLICY tenant_update ON public.%I FOR UPDATE USING ("organizationId"=bbd_private.organization_id() AND bbd_private.membership_role("organizationId") IN (''OWNER'',''ADMIN'')) WITH CHECK ("organizationId"=bbd_private.organization_id() AND bbd_private.membership_role("organizationId") IN (''OWNER'',''ADMIN''))',t);
 END LOOP;
END $$;
COMMIT;
