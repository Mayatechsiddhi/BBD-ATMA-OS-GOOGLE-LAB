import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb as admin } from "../../scripts/local-admin-db";
import { db } from "../../src/lib/db";
import { withActor } from "../../src/lib/tenant-context";
import * as access from "../../src/modules/organizations/access";
import * as outbox from "../../src/modules/events/outbox";
import { createOrganization } from "../../src/modules/organizations/service";
import { changeEntitlement } from "../../src/modules/entitlements/service";
import { createContact } from "../../src/modules/crm/service";
import { createOpportunity } from "../../src/modules/crm/opportunities";

const users = Array.from({ length: 6 }, () => randomUUID());
const [owner, foreign, manager, member, display, dual] = users;
const orgs: string[] = [];
let a: string, b: string, contactA: string, contactB: string;
const input = (contactId = contactA) => ({
  contactId,
  title: "Synthetic event opportunity",
  amount: "125.00",
  requestKey: randomUUID(),
});
beforeAll(async () => {
  await admin.user.createMany({
    data: users.map((id) => ({
      id,
      name: "Synthetic event fixture",
      email: `event-${id}@example.com`,
      emailVerified: true,
    })),
  });
  a = (
    await createOrganization(owner, {
      name: "Synthetic event A",
      slug: `event-${randomUUID()}`,
    })
  ).id;
  orgs.push(a);
  b = (
    await createOrganization(foreign, {
      name: "Synthetic event B",
      slug: `event-${randomUUID()}`,
    })
  ).id;
  orgs.push(b);
  await admin.membership.createMany({
    data: [
      { organizationId: a, userId: manager, role: "ADMIN" },
      { organizationId: a, userId: member, role: "MEMBER" },
      { organizationId: a, userId: display, role: "DISPLAY" },
      { organizationId: a, userId: dual, role: "ADMIN" },
      { organizationId: b, userId: dual, role: "ADMIN" },
    ],
  });
  contactA = (
    await createContact(owner, a, {
      name: "Synthetic contact A",
      email: `${randomUUID()}@example.com`,
    })
  ).id;
  contactB = (
    await createContact(foreign, b, {
      name: "Synthetic contact B",
      email: `${randomUUID()}@example.com`,
    })
  ).id;
});
afterAll(async () => {
  try {
    await admin.organization.deleteMany({ where: { id: { in: orgs } } });
    await admin.user.deleteMany({ where: { id: { in: users } } });
  } finally {
    await Promise.all([admin.$disconnect(), db.$disconnect()]);
  }
});

describe("transactional tenant outbox", () => {
  it("commits opportunity, safe event and audit together; concurrent replay emits exactly once", async () => {
    const data = input();
    const [first, replay] = await Promise.all([
      createOpportunity(owner, a, data),
      createOpportunity(manager, a, data),
    ]);
    expect(first.id).toBe(replay.id);
    const events = await admin.outboxEvent.findMany({
      where: { organizationId: a, opportunityId: first.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: "crm.opportunity.created",
      schemaVersion: 1,
      sequence: 1n,
      payload: { opportunityId: first.id },
    });
    expect(events[0].occurredAt).toBeInstanceOf(Date);
    expect(
      await admin.auditEvent.count({
        where: {
          organizationId: a,
          subjectId: first.id,
          action: "crm.opportunity.created",
        },
      }),
    ).toBe(1);
    await expect(
      createOpportunity(owner, a, { ...data, title: "Changed replay" }),
    ).rejects.toThrow("different values");
    await expect(
      access.withOrganization(owner, a, "crm:write", (tx) =>
        outbox.appendOpportunityCreated(tx, a, first.id),
      ),
    ).rejects.toThrow();
    expect(
      await admin.outboxEvent.count({ where: { organizationId: a } }),
    ).toBe(1);
  });
  it("rolls back the business mutation and audit when event append fails", async () => {
    const data = input();
    const append = vi
      .spyOn(outbox, "appendOpportunityCreated")
      .mockRejectedValueOnce(new Error("Synthetic outbox failure"));
    const before = await admin.auditEvent.count({
      where: { organizationId: a },
    });
    try {
      await expect(createOpportunity(owner, a, data)).rejects.toThrow(
        "Synthetic outbox failure",
      );
    } finally {
      append.mockRestore();
    }
    expect(
      await admin.opportunity.count({
        where: { organizationId: a, requestKey: data.requestKey },
      }),
    ).toBe(0);
    expect(
      await admin.outboxEvent.count({ where: { organizationId: a } }),
    ).toBe(1);
    expect(await admin.auditEvent.count({ where: { organizationId: a } })).toBe(
      before,
    );
  });
  it("rolls back an already inserted event and opportunity when audit fails; no cursor gap", async () => {
    const data = input();
    const append = vi
      .spyOn(access, "audit")
      .mockRejectedValueOnce(new Error("Synthetic audit failure"));
    try {
      await expect(createOpportunity(owner, a, data)).rejects.toThrow(
        "Synthetic audit failure",
      );
    } finally {
      append.mockRestore();
    }
    expect(
      await admin.opportunity.count({
        where: { organizationId: a, requestKey: data.requestKey },
      }),
    ).toBe(0);
    expect(
      await admin.outboxEvent.count({ where: { organizationId: a } }),
    ).toBe(1);
    await createOpportunity(owner, a, data);
    expect(
      (await outbox.readEventBatch(owner, a)).events.map(
        (event) => event.sequence,
      ),
    ).toEqual(["1", "2"]);
  });
  it("bounds ordered batches, supports replay and does not use timestamps or UUIDs as ordering", async () => {
    await Promise.all(
      Array.from({ length: 4 }, () => createOpportunity(manager, a, input())),
    );
    const rows = await admin.outboxEvent.findMany({
      where: { organizationId: a },
      orderBy: { sequence: "asc" },
    });
    expect(rows.map((row) => row.sequence)).toEqual([1n, 2n, 3n, 4n, 5n, 6n]);
    // Privileged fixture deliberately reverses event wall-clock ordering.
    await admin.outboxEvent.update({
      where: { id: rows.at(-1)!.id },
      data: { occurredAt: new Date("2000-01-01T00:00:00Z") },
    });
    const one = await outbox.readEventBatch(manager, a, { limit: 2 });
    expect(one.events.map((event) => event.sequence)).toEqual(["1", "2"]);
    expect(await outbox.readEventBatch(manager, a, { limit: 2 })).toEqual(one);
    const two = await outbox.readEventBatch(owner, a, {
      after: one.nextAfter,
      limit: 50,
    });
    expect(two.events.map((event) => event.sequence)).toEqual([
      "3",
      "4",
      "5",
      "6",
    ]);
    expect(
      await outbox.readEventBatch(owner, a, { after: two.nextAfter }),
    ).toEqual({ events: [], nextAfter: "6" });
    for (const actor of [foreign, member, display])
      await expect(outbox.readEventBatch(actor, a)).rejects.toThrow(
        "Access denied",
      );
    await createOpportunity(foreign, b, input(contactB));
    expect(
      (await outbox.readEventBatch(foreign, b)).events.map(
        (event) => event.sequence,
      ),
    ).toEqual(["1"]);
    expect(
      (await outbox.readEventBatch(dual, a)).events.every(
        (event) => event.organizationId === a,
      ),
    ).toBe(true);
  });
  it("enforces RLS without predicates or context and denies foreign parent, restricted roles and mutation grants", async () => {
    const own = await admin.opportunity.findFirstOrThrow({
      where: { organizationId: a },
    });
    const other = await admin.opportunity.findFirstOrThrow({
      where: { organizationId: b },
    });
    const otherEvent = await admin.outboxEvent.findFirstOrThrow({
      where: { organizationId: b },
    });
    const legacy = await admin.opportunity.create({
      data: {
        organizationId: a,
        contactId: contactA,
        title: "Synthetic legacy fixture",
        amountPaise: 1,
        requestKey: randomUUID(),
      },
    });
    const legacyB = await admin.opportunity.create({
      data: {
        organizationId: b,
        contactId: contactB,
        title: "Synthetic foreign legacy fixture",
        amountPaise: 1,
        requestKey: randomUUID(),
      },
    });
    const data = (organizationId = a, opportunityId = own.id) => ({
      id: randomUUID(),
      organizationId,
      opportunityId,
      sequence: 100n,
      eventType: "crm.opportunity.created",
      schemaVersion: 1,
      payload: { opportunityId },
    });
    expect(await db.outboxEvent.findMany()).toEqual([]);
    await expect(
      db.outboxEvent.create({ data: data(a, legacy.id) }),
    ).rejects.toThrow();
    for (const actor of [member, display]) {
      await withActor(
        actor,
        async (tx) => {
          expect(await tx.outboxEvent.findMany()).toEqual([]);
        },
        a,
      );
      await expect(
        withActor(
          actor,
          (tx) => tx.outboxEvent.create({ data: data(a, legacy.id) }),
          a,
        ),
      ).rejects.toThrow();
    }
    await withActor(
      dual,
      async (tx) => {
        expect(
          (await tx.outboxEvent.findMany()).every(
            (event) => event.organizationId === a,
          ),
        ).toBe(true);
        expect(
          await tx.outboxEvent.findMany({ where: { id: otherEvent.id } }),
        ).toEqual([]);
      },
      a,
    );
    await expect(
      withActor(
        dual,
        (tx) => tx.outboxEvent.create({ data: data(b, legacyB.id) }),
        a,
      ),
    ).rejects.toThrow();
    await expect(
      withActor(
        owner,
        (tx) => tx.outboxEvent.create({ data: data(a, other.id) }),
        a,
      ),
    ).rejects.toThrow();
    await expect(
      withActor(
        owner,
        (tx) =>
          tx.outboxEvent.updateMany({
            data: { occurredAt: new Date("2000-01-01T00:00:00Z") },
          }),
        a,
      ),
    ).rejects.toThrow();
    await expect(
      withActor(owner, (tx) => tx.outboxEvent.deleteMany(), a),
    ).rejects.toThrow();
    await expect(
      db.$executeRaw`TRUNCATE public."OutboxEvent"`,
    ).rejects.toThrow();
    await expect(
      withActor(
        owner,
        (tx) =>
          tx.outboxEvent.create({
            data: {
              ...data(a, legacy.id),
              payload: {
                opportunityId: legacy.id,
                email: "synthetic@example.com",
              },
            },
          }),
        a,
      ),
    ).rejects.toThrow();
  });
  it("does not fabricate historical events when replaying pre-outbox opportunities", async () => {
    const data = input();
    const existing = await admin.opportunity.create({
      data: {
        organizationId: a,
        contactId: contactA,
        title: data.title,
        amountPaise: 12500,
        requestKey: data.requestKey,
      },
    });
    expect((await createOpportunity(owner, a, data)).id).toBe(existing.id);
    expect(
      await admin.outboxEvent.count({ where: { opportunityId: existing.id } }),
    ).toBe(0);
  });
  it("requires enabled CRM even for owners and retains events while disabled", async () => {
    await changeEntitlement(owner, a, {
      moduleId: "crm",
      enabled: false,
      version: 0,
    });
    await expect(outbox.readEventBatch(owner, a)).rejects.toThrow(
      "Access denied",
    );
    await expect(createOpportunity(owner, a, input())).rejects.toThrow(
      "Access denied",
    );
    expect(
      await admin.outboxEvent.count({ where: { organizationId: a } }),
    ).toBe(6);
    await changeEntitlement(owner, a, {
      moduleId: "crm",
      enabled: true,
      version: 1,
    });
    expect((await outbox.readEventBatch(owner, a)).events).toHaveLength(6);
  });
});
