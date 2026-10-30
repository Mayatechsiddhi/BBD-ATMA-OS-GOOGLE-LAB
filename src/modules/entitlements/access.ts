import type { Prisma, Role } from "@/generated/prisma/client";
import { withOrganization } from "@/modules/organizations/access";
import { AccessError, type Permission } from "@/modules/organizations/policy";
import { moduleAvailable, type ModuleId } from "@/modules/registry";

export async function assertModuleAccess(
  tx: Prisma.TransactionClient,
  organizationId: string,
  moduleId: string,
) {
  if (!moduleAvailable(moduleId)) throw new AccessError();
  const entitlement = await tx.organizationModule.findUnique({
    where: { organizationId_moduleId: { organizationId, moduleId } },
    select: { enabled: true },
  });
  if (entitlement?.enabled !== true) throw new AccessError();
}

// Bind the module in trusted service code, never from a form or URL. Check
// membership AND entitlement under the same lock/transaction as the operation.
export function moduleAccess(moduleId: ModuleId) {
  return async function withModule<T>(
    actor: string,
    organizationId: string,
    permission: Permission,
    run: (tx: Prisma.TransactionClient, role: Role) => Promise<T>,
  ) {
    return withOrganization(
      actor,
      organizationId,
      permission,
      async (tx, role) => {
        await assertModuleAccess(tx, organizationId, moduleId);
        return run(tx, role);
      },
    );
  };
}
