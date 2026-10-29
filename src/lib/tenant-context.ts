import { Prisma, type Organization } from "@/generated/prisma/client";
import { db } from "./db";
import { runtimePrivilegeAuditSQL } from "./runtime-privileges";
export async function assertRuntimeDatabase(tx: Prisma.TransactionClient = db) {
  const [role] = await tx.$queryRaw<
    { unsafe: boolean; protectedTables: number; transactionContext: boolean }[]
  >`
    SELECT (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole
      OR has_schema_privilege(session_user,'public','CREATE')
      OR has_schema_privilege(session_user,'bbd_private','CREATE')
      OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.oid)
      OR EXISTS (SELECT 1 FROM pg_roles elevated WHERE
        (elevated.rolsuper OR elevated.rolbypassrls OR elevated.rolcreaterole OR elevated.rolcreatedb)
        AND pg_has_role(session_user,elevated.oid,'MEMBER'))
      OR EXISTS (SELECT 1 FROM pg_class c WHERE c.oid IN
        ('public."Organization"'::regclass,'public."Membership"'::regclass,
         'public."Invitation"'::regclass,'public."AuditEvent"'::regclass,'public."Contact"'::regclass,'public."ClinicLead"'::regclass,'public."Appointment"'::regclass,'public."FollowUp"'::regclass,'public."Patient"'::regclass,'public."Doctor"'::regclass,'public."QueueToken"'::regclass,'public."Opportunity"'::regclass)
        AND pg_has_role(session_user,c.relowner,'MEMBER'))
      OR EXISTS (SELECT 1 FROM pg_database d WHERE d.datname=current_database()
        AND pg_has_role(session_user,d.datdba,'MEMBER'))) AS unsafe,
      (SELECT count(*)::int FROM pg_class WHERE oid IN
        ('public."Organization"'::regclass,'public."Membership"'::regclass,
         'public."Invitation"'::regclass,'public."AuditEvent"'::regclass,'public."Contact"'::regclass,'public."ClinicLead"'::regclass,'public."Appointment"'::regclass,'public."FollowUp"'::regclass,'public."Patient"'::regclass,'public."Doctor"'::regclass,'public."QueueToken"'::regclass,'public."Opportunity"'::regclass)
        AND relrowsecurity AND relforcerowsecurity) AS "protectedTables",
      EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public."Membership"'::regclass AND polname='membership_self') AS "transactionContext"
    FROM pg_roles r WHERE r.rolname=session_user`;
  if (
    !role ||
    role.unsafe ||
    role.protectedTables !== 12 ||
    !role.transactionContext
  )
    throw new Error("Unsafe runtime database role or missing tenant RLS");
  const drift = await tx.$queryRaw<unknown[]>(
    Prisma.raw(runtimePrivilegeAuditSQL("session_user")),
  );
  if (drift.length) throw new Error("Unsafe runtime database privileges");
}
export async function setOrganizationContext(
  tx: Prisma.TransactionClient,
  organizationId: string,
) {
  await tx.$queryRaw`SELECT set_config('bbd.organization_id',${organizationId},true)`;
}
export async function withActor<T>(
  userId: string,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
  organizationId = "",
  invitationHash = "",
) {
  if (!userId) throw new Error("Actor required");
  return db.$transaction(async (tx) => {
    await assertRuntimeDatabase(tx);
    await tx.$queryRaw`SELECT set_config('bbd.context_transaction',pg_current_xact_id()::text,true),set_config('bbd.actor_id',${userId},true),set_config('bbd.organization_id',${organizationId},true),set_config('bbd.invitation_hash',${invitationHash},true)`;
    return run(tx);
  });
}
export async function bootstrapOrganization(
  tx: Prisma.TransactionClient,
  id: string,
  name: string,
  slug: string,
) {
  const [org] = await tx.$queryRaw<
    Organization[]
  >`SELECT * FROM bbd_private.create_organization(${id},${name},${slug})`;
  return org;
}
