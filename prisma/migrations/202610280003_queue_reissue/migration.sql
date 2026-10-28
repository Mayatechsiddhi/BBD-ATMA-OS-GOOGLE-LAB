BEGIN;
-- Preserve cancelled-token history while allowing a rescheduled appointment or
-- cancelled visit to receive a new number. Never recycle an issued number.
ALTER TABLE "QueueToken" DROP CONSTRAINT "QueueToken_organizationId_appointmentId_key";
ALTER TABLE "QueueToken" DROP CONSTRAINT "QueueToken_organizationId_appointmentId_leadId_key";
ALTER TABLE "QueueToken" DROP CONSTRAINT "QueueToken_organizationId_day_doctorId_patientId_key";
CREATE UNIQUE INDEX "QueueToken_active_appointment" ON "QueueToken"("organizationId","appointmentId") WHERE "appointmentId" IS NOT NULL AND status<>'CANCELLED';
CREATE UNIQUE INDEX "QueueToken_active_patient_doctor_day" ON "QueueToken"("organizationId",day,"doctorId","patientId") WHERE status<>'CANCELLED';
COMMIT;
