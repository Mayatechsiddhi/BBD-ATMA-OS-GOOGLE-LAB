import { withOrganization, audit } from "@/modules/organizations/access";
import { AccessError } from "@/modules/organizations/policy";
import { modules, moduleAvailable } from "@/modules/registry";
import { entitlementInput, EntitlementConflict } from "./validation";

export async function listModules(actor: string, organizationId: string) {
  return withOrganization(actor, organizationId, "read", async (tx) => {
    const rows = await tx.organizationModule.findMany({
      where: { organizationId },
    });
    return modules.map((module) => {
      const row = rows.find((row) => row.moduleId === module.id);
      return {
        ...module,
        enabled: module.available && row?.enabled === true,
        version: row?.version ?? 0,
      };
    });
  });
}

export async function changeEntitlement(
  actor: string,
  organizationId: string,
  input: unknown,
) {
  const data = entitlementInput.parse(input);
  return withOrganization(
    actor,
    organizationId,
    "modules:manage",
    async (tx) => {
      // Even an OWNER cannot activate code that is not available in this release.
      if (!moduleAvailable(data.moduleId)) throw new AccessError();
      const where = {
        organizationId_moduleId: { organizationId, moduleId: data.moduleId },
      };
      const previous = await tx.organizationModule.findUnique({ where });
      if ((previous?.version ?? 0) !== data.version)
        throw new EntitlementConflict();
      if ((previous?.enabled ?? false) === data.enabled) return;
      await tx.organizationModule.upsert({
        where,
        create: {
          organizationId,
          moduleId: data.moduleId,
          enabled: data.enabled,
          version: 1,
        },
        update: { enabled: data.enabled, version: { increment: 1 } },
      });
      await audit(
        tx,
        organizationId,
        actor,
        `module.${data.moduleId}.${data.enabled ? "enabled" : "disabled"}`,
        data.moduleId,
      );
    },
  );
}
