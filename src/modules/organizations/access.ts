import { Prisma, type Role } from "@/generated/prisma/client";
import { withActor } from "@/lib/tenant-context";
import { authorize, type Permission } from "./policy";
// All tenant operations authorize inside the same transaction as their reads/writes.
// Readers share a lock; mutations/revocations remain exclusive. All acquire the
// lock BEFORE membership authorization and retain it until transaction end.
export async function withOrganization<T>(
  userId: string,
  organizationId: string,
  permission: Permission,
  run: (tx: Prisma.TransactionClient, role: Role) => Promise<T>,
) {
  return withActor(
    userId,
    async (tx) => {
      if (permission === "read" || permission === "display:read")
        await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${organizationId}, 0))`;
      else
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId}, 0))`;
      const member = await tx.membership.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
      });
      authorize(member?.role, permission);
      return run(tx, member!.role);
    },
    organizationId,
  );
}
export async function audit(
  tx: Prisma.TransactionClient,
  organizationId: string,
  actorId: string,
  action: string,
  subjectId?: string,
) {
  // Do not require audit SELECT rights to append. Display-only invitees must
  // record acceptance without gaining access to the private audit directory.
  await tx.auditEvent.createMany({
    data: [{ organizationId, actorId, action, subjectId }],
  });
}
