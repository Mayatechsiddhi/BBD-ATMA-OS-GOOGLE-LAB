import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "../../src/generated/prisma/client";
vi.mock("../../src/modules/organizations/access", () => ({
  withOrganization: vi.fn(),
}));
import {
  modules,
  moduleAvailable,
  initialModuleIds,
} from "../../src/modules/registry";
import {
  assertModuleAccess,
  moduleAccess,
} from "../../src/modules/entitlements/access";
import { entitlementInput } from "../../src/modules/entitlements/validation";
import { withOrganization } from "../../src/modules/organizations/access";

describe("fail-closed module policy", () => {
  it("has unique catalog keys, only implemented modules available, and explicit initial grants", () => {
    expect(new Set(modules.map((m) => m.id)).size).toBe(modules.length);
    expect(modules.filter((m) => m.available).map((m) => m.id)).toEqual([
      "crm",
      "clinic",
    ]);
    expect(initialModuleIds).toEqual(["crm", "clinic"]);
    for (const id of [
      "atma",
      "agents",
      "workflows",
      "marketing",
      "industry",
      "CRM",
      "__proto__",
      "missing",
    ])
      expect(moduleAvailable(id)).toBe(false);
  });
  it("requires a literal boolean, bounded integer version and known key; rejects actor/tenant injection", () => {
    const input = { moduleId: "crm", enabled: true, version: 0 };
    expect(entitlementInput.parse(input)).toEqual(input);
    for (const change of [
      { moduleId: "unknown" },
      { enabled: "false" },
      { version: -1 },
      { version: 1.5 },
      { version: 2147483647 },
      { actor: "forged" },
      { organizationId: "foreign" },
    ])
      expect(() => entitlementInput.parse({ ...input, ...change })).toThrow();
  });
  it("denies missing/disabled rows and planned modules even if a row claims enabled", async () => {
    const lookup = vi.fn();
    const tx = {
      organizationModule: { findUnique: lookup },
    } as unknown as Prisma.TransactionClient;
    for (const row of [null, { enabled: false }]) {
      lookup.mockResolvedValue(row);
      await expect(assertModuleAccess(tx, "tenant-a", "crm")).rejects.toThrow(
        "Access denied",
      );
    }
    lookup.mockResolvedValue({ enabled: true });
    await expect(
      assertModuleAccess(tx, "tenant-a", "crm"),
    ).resolves.toBeUndefined();
    expect(lookup).toHaveBeenLastCalledWith({
      where: {
        organizationId_moduleId: {
          organizationId: "tenant-a",
          moduleId: "crm",
        },
      },
      select: { enabled: true },
    });
    lookup.mockClear();
    for (const moduleId of ["atma", "unknown"])
      await expect(
        assertModuleAccess(tx, "tenant-a", moduleId),
      ).rejects.toThrow("Access denied");
    expect(lookup).not.toHaveBeenCalled();
  });
  it("runs entitlement and operation in the membership-authorized transaction; never calls operation on denial", async () => {
    const tx = {
      organizationModule: {
        findUnique: vi.fn().mockResolvedValue({ enabled: false }),
      },
    } as unknown as Prisma.TransactionClient;
    vi.mocked(withOrganization).mockImplementation(
      async (_actor, _org, _permission, run) => run(tx, "ADMIN"),
    );
    const operation = vi.fn().mockResolvedValue("ok");
    const run = moduleAccess("clinic");
    await expect(
      run("trusted-actor", "tenant-a", "crm:write", operation),
    ).rejects.toThrow("Access denied");
    expect(operation).not.toHaveBeenCalled();
    vi.mocked(tx.organizationModule.findUnique).mockResolvedValue({
      enabled: true,
    } as never);
    await expect(
      run("trusted-actor", "tenant-a", "crm:write", operation),
    ).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledWith(tx, "ADMIN");
    expect(withOrganization).toHaveBeenLastCalledWith(
      "trusted-actor",
      "tenant-a",
      "crm:write",
      expect.any(Function),
    );
  });
});
