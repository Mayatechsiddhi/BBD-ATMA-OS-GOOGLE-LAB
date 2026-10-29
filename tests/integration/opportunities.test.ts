import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { adminDb as admin } from "../../scripts/local-admin-db";
import { db } from "../../src/lib/db";
import { withActor } from "../../src/lib/tenant-context";
import { createOrganization } from "../../src/modules/organizations/service";
import { createContact } from "../../src/modules/crm/service";
import {
  createOpportunity,
  transitionOpportunity,
  listOpportunities,
} from "../../src/modules/crm/opportunities";
const users = Array.from({ length: 5 }, () => randomUUID());
const [a, b, member, display, dual] = users;
const orgs: string[] = [];
let org: string,
  foreign: string,
  contact: string,
  foreignContact: string,
  deal: string;
const input = () => ({
  contactId: contact,
  title: "Synthetic opportunity",
  amount: "2500.05",
  requestKey: randomUUID(),
});
beforeAll(async () => {
  await admin.user.createMany({
    data: users.map((id) => ({
      id,
      name: "Synthetic opportunity fixture",
      email: `deal-${id}@example.com`,
      emailVerified: true,
    })),
  });
  org = (
    await createOrganization(a, {
      name: "Synthetic Deals A",
      slug: `deals-${randomUUID()}`,
    })
  ).id;
  orgs.push(org);
  foreign = (
    await createOrganization(b, {
      name: "Synthetic Deals B",
      slug: `deals-${randomUUID()}`,
    })
  ).id;
  orgs.push(foreign);
  await admin.membership.createMany({
    data: [
      { organizationId: org, userId: member, role: "MEMBER" },
      { organizationId: org, userId: display, role: "DISPLAY" },
      { organizationId: org, userId: dual, role: "ADMIN" },
      { organizationId: foreign, userId: dual, role: "ADMIN" },
    ],
  });
  contact = (
    await createContact(a, org, {
      name: "Synthetic Client A",
      email: `client-a-${randomUUID()}@example.com`,
      company: "",
    })
  ).id;
  foreignContact = (
    await createContact(b, foreign, {
      name: "Synthetic Client B",
      email: `client-b-${randomUUID()}@example.com`,
      company: "",
    })
  ).id;
});
afterAll(async () => {
  try {
    await admin.organization.deleteMany({ where: { id: { in: orgs } } });
    await admin.user.deleteMany({ where: { id: { in: users } } });
  } finally {
    await admin.$disconnect();
    await db.$disconnect();
  }
});
describe("tenant-isolated persisted opportunities", () => {
  it("creates once under concurrent replay and appends exactly one audit", async () => {
    const data = input();
    const results = await Promise.all([
      createOpportunity(a, org, data),
      createOpportunity(a, org, data),
    ]);
    deal = results[0].id;
    expect(results[1].id).toBe(deal);
    expect(results[0].amountPaise).toBe(250005);
    expect(
      await admin.auditEvent.count({
        where: {
          organizationId: org,
          action: "crm.opportunity.created",
          subjectId: deal,
        },
      }),
    ).toBe(1);
    await expect(
      createOpportunity(a, org, { ...data, title: "Changed replay" }),
    ).rejects.toThrow("different values");
  });
  it("denies foreign selectors, dual-member cross-context parents and restricted roles", async () => {
    for (const actor of [b, member, display])
      await expect(createOpportunity(actor, org, input())).rejects.toThrow(
        "Access denied",
      );
    await expect(
      createOpportunity(dual, org, { ...input(), contactId: foreignContact }),
    ).rejects.toThrow("Access denied");
    await expect(
      transitionOpportunity(b, foreign, deal, 0, "PROPOSAL"),
    ).rejects.toThrow("Access denied");
    await expect(listOpportunities(display, org)).rejects.toThrow(
      "Access denied",
    );
    expect((await listOpportunities(member, org)).total).toBe(1);
    expect((await listOpportunities(b, foreign)).total).toBe(0);
  });
  it("enforces missing/foreign context, tenant FK and immutable identity at database level", async () => {
    expect(await db.opportunity.findMany()).toEqual([]);
    await expect(
      db.opportunity.create({
        data: {
          organizationId: org,
          contactId: contact,
          title: "Unscoped denied",
          amountPaise: 1,
          requestKey: randomUUID(),
        },
      }),
    ).rejects.toThrow();
    await withActor(
      member,
      async (tx) => {
        expect(
          await tx.opportunity.updateMany({
            where: { id: deal },
            data: { stage: "LOST" },
          }),
        ).toEqual({ count: 0 });
      },
      org,
    );
    await withActor(
      display,
      async (tx) => {
        expect(await tx.opportunity.findMany()).toEqual([]);
      },
      org,
    );
    await withActor(
      b,
      async (tx) => {
        expect(await tx.opportunity.findMany({ where: { id: deal } })).toEqual(
          [],
        );
        expect(
          await tx.opportunity.updateMany({
            where: { id: deal },
            data: { stage: "LOST" },
          }),
        ).toEqual({ count: 0 });
      },
      foreign,
    );
    await expect(
      withActor(
        a,
        (tx) =>
          tx.opportunity.create({
            data: {
              organizationId: org,
              contactId: foreignContact,
              title: "Forbidden foreign parent",
              amountPaise: 1,
              requestKey: randomUUID(),
            },
          }),
        org,
      ),
    ).rejects.toThrow();
    await expect(
      withActor(
        a,
        (tx) =>
          tx.opportunity.update({
            where: { id: deal },
            data: { organizationId: foreign },
          }),
        org,
      ),
    ).rejects.toThrow();
    await expect(
      withActor(
        a,
        (tx) => tx.opportunity.deleteMany({ where: { id: deal } }),
        org,
      ),
    ).rejects.toThrow();
  });
  it("serializes stage changes with optimistic versions and never reopens terminal deals", async () => {
    await expect(transitionOpportunity(a, org, deal, 0, "WON")).rejects.toThrow(
      "not allowed",
    );
    const moved = await Promise.allSettled([
      transitionOpportunity(a, org, deal, 0, "PROPOSAL"),
      transitionOpportunity(dual, org, deal, 0, "PROPOSAL"),
    ]);
    expect(moved.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expect(
      transitionOpportunity(member, org, deal, 1, "WON"),
    ).rejects.toThrow("Access denied");
    await transitionOpportunity(a, org, deal, 1, "WON");
    await expect(
      transitionOpportunity(a, org, deal, 2, "OPEN"),
    ).rejects.toThrow("not allowed");
    expect(
      await admin.auditEvent.count({
        where: {
          organizationId: org,
          subjectId: deal,
          action: { startsWith: "crm.opportunity." },
        },
      }),
    ).toBe(3);
  });
  it("provides deterministic page/search/stage isolation beyond the first page", async () => {
    const data = Array.from({ length: 30 }, (_, i) => ({
      organizationId: org,
      contactId: contact,
      title: `Synthetic extra ${i}`,
      amountPaise: i,
      requestKey: randomUUID(),
    }));
    await admin.opportunity.createMany({ data });
    await createOpportunity(b, foreign, {
      ...input(),
      contactId: foreignContact,
      title: "Foreign secret target",
    });
    const one = await listOpportunities(a, org, { page: 1, stage: "OPEN" });
    const two = await listOpportunities(a, org, { page: 2, stage: "OPEN" });
    expect(one.opportunities).toHaveLength(25);
    expect(two.opportunities).toHaveLength(5);
    expect(
      new Set([...one.opportunities, ...two.opportunities].map((o) => o.id))
        .size,
    ).toBe(30);
    expect(
      (await listOpportunities(dual, org, { search: "Foreign secret target" }))
        .total,
    ).toBe(0);
    expect(
      (
        await listOpportunities(a, org, {
          search: "Synthetic Client A",
          stage: "WON",
        })
      ).total,
    ).toBe(1);
  });
});
