BEGIN;
-- Additive configuration on the existing tenant/RLS-protected Doctor row.
-- NULL preserves legacy resource booking until staff explicitly configure hours.
ALTER TABLE "Doctor" ADD COLUMN "schedule" JSONB,
 ADD COLUMN "scheduleVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Doctor" ADD CONSTRAINT "Doctor_schedule_object"
 CHECK ("schedule" IS NULL OR jsonb_typeof("schedule") = 'object'),
 ADD CONSTRAINT "Doctor_schedule_version_nonnegative" CHECK ("scheduleVersion" >= 0);
COMMIT;
