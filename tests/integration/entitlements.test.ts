import type { Prisma } from "../../src/generated/prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb as admin } from "../../scripts/local-admin-db";
import { db } from "../../src/lib/db";
import { withActor } from "../../src/lib/tenant-context";
import * as access from "../../src/modules/organizations/access";
import { withOrganization } from "../../src/modules/organizations/access";
import {
  createOrganization,
  getOrganization,
} from "../../src/modules/organizations/service";
import {
  listModules,
  changeEntitlement,
} from "../../src/modules/entitlements/service";
import { moduleAccess } from "../../src/modules/entitlements/access";
import { createContact, listContacts } from "../../src/modules/crm/service";
import { listOpportunities } from "../../src/modules/crm/opportunities";
import {
  createLead,
  listLeads,
  dashboard,
} from "../../src/modules/clinic/service";
import { doctorSchedules } from "../../src/modules/clinic/schedule-service";
import { board } from "../../src/modules/calling/service";

const users = Array.from({ length: 6 }, () => randomUUID());
const [owner, foreignOwner, manager, member, display, dual] = users;
const orgs: string[] = [];
let a: string, b: string;
const contact = () => ({
  name: "Synthetic entitled client",
  email: `${randomUUID()}@example.com`,
});
async function toggle(
  org: string,
  moduleId: "crm" | "clinic",
  enabled: boolean,
) {
  const current = (await listModules(owner, org)).find(
    (m) => m.id === moduleId,
  )!;
  await changeEntitlement(owner, org, {
    moduleId,
    enabled,
    version: current.version,
  });
}
beforeAll(async () => {
  await admin.user.createMany({
    data: users.map((id) => ({
      id,
      name: "Synthetic module fixture",
      email: `module-${id}@example.com`,
      emailVerified: true,
    })),
  });
  a = (
    await createOrganization(owner, {
      name: "Synthetic Modules A",
      slug: `module-${randomUUID()}`,
    })
  ).id;
  orgs.push(a);
  b = (
    await createOrganization(foreignOwner, {
      name: "Synthetic Modules B",
      slug: `module-${randomUUID()}`,
    })
  ).id;
  orgs.push(b);
  await admin.membership.createMany({
    data: [
      { organizationId: a, userId: manager, role: "ADMIN" },
      { organizationId: a, userId: member, role: "MEMBER" },
      { organizationId: a, userId: display, role: "DISPLAY" },
      { organizationId: a, userId: dual, role: "OWNER" },
      { organizationId: b, userId: dual, role: "OWNER" },
    ],
  });
});
afterAll(async () => {
  try {
    await admin.organization.deleteMany({ where: { id: { in: orgs } } });
    await admin.user.deleteMany({ where: { id: { in: users } } });
  } finally {
    await Promise.all([admin.$disconnect(), db.$disconnect()]);
  }
});

describe("persisted tenant module entitlements under restricted runtime role", () => {
  it("preserves working modules on new organization bootstrap; planned entries denied", async () => {
    const catalog = await listModules(member, a);
    expect(catalog.filter((m) => m.enabled).map((m) => m.id)).toEqual([
      "crm",
      "clinic",
    ]);
    expect(catalog.filter((m) => !m.available).every((m) => !m.enabled)).toBe(
      true,
    );
    await expect(
      moduleAccess("atma")(owner, a, "read", async () => true),
    ).rejects.toThrow("Access denied");
    await expect(
      changeEntitlement(owner, a, {
        moduleId: "atma",
        enabled: true,
        version: 0,
      }),
    ).rejects.toThrow("Access denied");
  });
  it("denies foreign tenant selectors and all non-owner entitlement writes", async () => {
    for (const actor of [foreignOwner, manager, member, display])
      await expect(
        changeEntitlement(actor, a, {
          moduleId: "crm",
          enabled: false,
          version: 0,
        }),
      ).rejects.toThrow("Access denied");
    await expect(listModules(owner, b)).rejects.toThrow("Access denied");
    await expect(listModules(display, a)).rejects.toThrow("Access denied");
    expect(
      (await listModules(manager, a)).filter((m) => m.enabled),
    ).toHaveLength(2);
  });
  it("audits once, rejects stale replay, blocks reads/writes and preserves data and other module/tenant access", async () => {
    const existing = await createContact(owner, a, contact());
    await toggle(a, "crm", false);
    const row = await admin.organizationModule.findUniqueOrThrow({
      where: {
        organizationId_moduleId: { organizationId: a, moduleId: "crm" },
      },
    });
    expect(row.version).toBe(1);
    for (const actor of [owner, manager, member, dual]) {
      await expect(listContacts(actor, a)).rejects.toThrow("Access denied");
      await expect(listOpportunities(actor, a)).rejects.toThrow(
        "Access denied",
      );
    }
    await expect(getOrganization(owner, a, "crm")).rejects.toThrow(
      "Access denied",
    );
    await expect(createContact(owner, a, contact())).rejects.toThrow(
      "Access denied",
    );
    await expect(
      changeEntitlement(owner, a, {
        moduleId: "crm",
        enabled: false,
        version: 0,
      }),
    ).rejects.toThrow("Module access changed");
    await changeEntitlement(owner, a, {
      moduleId: "crm",
      enabled: false,
      version: 1,
    });
    expect(
      await admin.auditEvent.count({
        where: {
          organizationId: a,
          action: "module.crm.disabled",
          subjectId: "crm",
          actorId: owner,
        },
      }),
    ).toBe(1);
    expect(await admin.contact.count({ where: { id: existing.id } })).toBe(1);
    expect(await listContacts(foreignOwner, b)).toEqual([]);
    await dashboard(owner, a);
    await getOrganization(owner, a); // control plane remains reachable
    await toggle(a, "crm", true);
    expect((await listContacts(member, a)).map((c) => c.id)).toContain(
      existing.id,
    );
    await expect(createContact(member, a, contact())).rejects.toThrow(
      "Access denied",
    );
  });
  it("blocks clinic reads, writes, scheduling and calling projection including existing DISPLAY access", async () => {
    await board(display, a);
    await toggle(a, "clinic", false);
    for (const operation of [
      () => listLeads(owner, a, {}),
      () => dashboard(owner, a),
      () => doctorSchedules(owner, a),
      () => board(display, a),
      () =>
        createLead(owner, a, {
          name: "Synthetic denied patient",
          phone: "+919876543210",
          email: "",
          source: "PHONE",
        }),
    ])
      await expect(operation()).rejects.toThrow("Access denied");
    await listContacts(owner, a);
    await board(foreignOwner, b);
    await toggle(a, "clinic", true);
    await board(display, a);
  });
  it("defaults deny missing entitlement rows, including after a catalog release without a grant", async () => {
    await admin.organizationModule.delete({
      where: {
        organizationId_moduleId: { organizationId: a, moduleId: "crm" },
      },
    });
    expect(
      (await listModules(owner, a)).find((m) => m.id === "crm")?.enabled,
    ).toBe(false);
    await expect(listContacts(owner, a)).rejects.toThrow("Access denied");
    await toggle(a, "crm", true);
    await listContacts(owner, a);
  });
  it("isolates unscoped/raw reads and denies foreign, non-owner, identity and delete writes through RLS/grants", async () => {
    expect(await db.organizationModule.findMany()).toEqual([]);
    await expect(
      db.organizationModule.create({
        data: { organizationId: b, moduleId: "marketing" },
      }),
    ).rejects.toThrow();
    await withActor(
      dual,
      async (tx) => {
        expect(
          (await tx.organizationModule.findMany()).every(
            (row) => row.organizationId === a,
          ),
        ).toBe(true);
        expect(
          await tx.organizationModule.updateMany({
            where: { organizationId: b },
            data: { enabled: false },
          }),
        ).toEqual({ count: 0 });
      },
      a,
    );
    await withActor(
      manager,
      async (tx) => {
        expect(
          await tx.organizationModule.updateMany({
            where: { organizationId: a },
            data: { enabled: false },
          }),
        ).toEqual({ count: 0 });
      },
      a,
    );
    for (const run of [
      (tx: Prisma.TransactionClient) =>
        tx.organizationModule.create({
          data: { organizationId: b, moduleId: "marketing" },
        }),
      (tx: Prisma.TransactionClient) =>
        tx.organizationModule.updateMany({ data: { organizationId: b } }),
      (tx: Prisma.TransactionClient) => tx.organizationModule.deleteMany(),
      (tx: Prisma.TransactionClient) =>
        tx.organizationModule.create({
          data: { organizationId: a, moduleId: "atma", enabled: true },
        }),
    ])
      await expect(withActor<unknown>(owner, run, a)).rejects.toThrow();
    await expect(
      withActor(
        manager,
        (tx) =>
          tx.organizationModule.create({
            data: { organizationId: a, moduleId: "marketing" },
          }),
        a,
      ),
    ).rejects.toThrow();
  });
  it("rolls back the entitlement when the audit append fails", async () => {
    const before = (await listModules(owner, a)).find((m) => m.id === "crm")!;
    const count = await admin.auditEvent.count({
      where: { organizationId: a },
    });
    const append = vi
      .spyOn(access, "audit")
      .mockRejectedValueOnce(new Error("Synthetic audit failure"));
    try {
      await expect(
        changeEntitlement(owner, a, {
          moduleId: "crm",
          enabled: false,
          version: before.version,
        }),
      ).rejects.toThrow("Synthetic audit failure");
    } finally {
      append.mockRestore();
    }
    expect((await listModules(owner, a)).find((m) => m.id === "crm")).toEqual(
      before,
    );
    expect(await admin.auditEvent.count({ where: { organizationId: a } })).toBe(
      count,
    );
  });
  it("serializes concurrent changes, accepting one version and exactly one audit", async () => {
    const current = (await listModules(owner, a)).find((m) => m.id === "crm")!;
    const auditCount = await admin.auditEvent.count({
      where: { organizationId: a, action: "module.crm.disabled" },
    });
    const results = await Promise.allSettled([
      changeEntitlement(owner, a, {
        moduleId: "crm",
        enabled: false,
        version: current.version,
      }),
      changeEntitlement(dual, a, {
        moduleId: "crm",
        enabled: false,
        version: current.version,
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(
      (await listModules(owner, a)).find((m) => m.id === "crm")?.version,
    ).toBe(current.version + 1);
    expect(
      await admin.auditEvent.count({
        where: { organizationId: a, action: "module.crm.disabled" },
      }),
    ).toBe(auditCount + 1);
    await toggle(a, "crm", true);
  });
  it("holds entitlement revocation behind an active module transaction and rejects subsequent operations", async () => {
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reader = moduleAccess("crm")(member, a, "read", async (tx) => {
      await tx.contact.count({ where: { organizationId: a } });
      enter();
      await released;
    });
    await entered;
    let disabled = false;
    const revoke = toggle(a, "crm", false).then(() => {
      disabled = true;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 75));
      expect(disabled).toBe(false);
    } finally {
      release();
      await Promise.all([reader, revoke]);
    }
    await expect(listContacts(member, a)).rejects.toThrow("Access denied");
    await toggle(a, "crm", true);
    await withOrganization(owner, a, "modules:manage", async (tx) => {
      const locks = await tx.$queryRaw<
        { mode: string }[]
      >`SELECT mode FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid()`;
      expect(locks.map((lock) => lock.mode)).toEqual(["ExclusiveLock"]);
    });
  });
});
