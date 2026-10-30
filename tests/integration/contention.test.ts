import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../../scripts/local-admin-db";
import { db } from "../../src/lib/db";
import { withOrganization } from "../../src/modules/organizations/access";
import {
  createOrganization,
  changeMember,
} from "../../src/modules/organizations/service";
import { createContact } from "../../src/modules/crm/service";

const users = [randomUUID(), randomUUID(), randomUUID()];
const orgs: string[] = [];
const contacts: string[] = [];
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !url.pathname.endsWith("_test")
  )
    throw new Error("Dedicated local load-test database required");
  await adminDb.user.createMany({
    data: users.map((id) => ({
      id,
      name: "Synthetic contention fixture",
      email: `contention-${id}@example.com`,
      emailVerified: true,
    })),
  });
  for (let i = 0; i < 2; i++) {
    const org = await createOrganization(users[i], {
      name: "Synthetic contention clinic",
      slug: `contention-${randomUUID()}`,
    });
    orgs.push(org.id);
    contacts.push(
      (
        await createContact(users[i], org.id, {
          name: "Synthetic scoped contact",
          email: "contact@example.com",
        })
      ).id,
    );
  }
  await adminDb.membership.create({
    data: { organizationId: orgs[0], userId: users[2], role: "MEMBER" },
  });
});
afterAll(async () => {
  try {
    await adminDb.organization.deleteMany({ where: { id: { in: orgs } } });
    await adminDb.user.deleteMany({ where: { id: { in: users } } });
  } finally {
    await Promise.all([adminDb.$disconnect(), db.$disconnect()]);
  }
});

describe("tenant lock contention and scoped load", () => {
  it("uses shared read/display locks and exclusive write locks", async () => {
    for (const permission of [
      "read",
      "display:read",
      "events:read",
      "crm:write",
      "members",
    ] as const) {
      await withOrganization(users[0], orgs[0], permission, async (tx) => {
        const locks = await tx.$queryRaw<
          { mode: string }[]
        >`SELECT mode FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid()`;
        expect(locks.map((x) => x.mode)).toEqual([
          permission === "read" ||
          permission === "display:read" ||
          permission === "events:read"
            ? "ShareLock"
            : "ExclusiveLock",
        ]);
      });
    }
  });

  it("keeps revocation exclusive until an authorized active reader finishes", async () => {
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reader = withOrganization(users[2], orgs[0], "read", async (tx) => {
      expect((await tx.contact.findMany()).map((x) => x.id)).toEqual([
        contacts[0],
      ]);
      enter();
      await released;
    });
    await entered;
    let revoked = false;
    const revoke = changeMember(users[0], orgs[0], users[2], null).then(() => {
      revoked = true;
    });
    try {
      // A one-backend transaction pooler queues the writer before it reaches
      // pg_locks. Assert the observable permission boundary, not that internal
      // queue location. The separate lock-mode case checks the actual modes.
      await new Promise((resolve) => setTimeout(resolve, 75));
      expect(revoked).toBe(false);
      expect(
        await adminDb.membership.count({
          where: { organizationId: orgs[0], userId: users[2] },
        }),
      ).toBe(1);
    } finally {
      release();
      await Promise.all([reader, revoke]);
    }
    await expect(
      withOrganization(users[2], orgs[0], "read", (tx) =>
        tx.contact.findMany(),
      ),
    ).rejects.toThrow("Access denied");
    expect(
      await adminDb.auditEvent.count({
        where: { organizationId: orgs[0], subjectId: users[2] },
      }),
    ).toBeGreaterThan(0);
  });

  it("preserves tenant isolation under 40 reads at concurrency eight", async () => {
    let next = 0;
    const latencies: number[] = [];
    const started = performance.now();
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        while (next < 40) {
          const index = next++,
            tenant = index % 2,
            begin = performance.now();
          await withOrganization(
            users[tenant],
            orgs[tenant],
            "read",
            async (tx) => {
              await tx.$executeRaw`SELECT pg_sleep(0.02)`;
              expect((await tx.contact.findMany()).map((x) => x.id)).toEqual([
                contacts[tenant],
              ]);
            },
          );
          latencies.push(performance.now() - begin);
        }
      }),
    );
    latencies.sort((a, b) => a - b);
    console.log(
      "BBD_LOAD_METRICS " +
        JSON.stringify({
          label: process.env.LOAD_LABEL ?? "current",
          reads: latencies.length,
          concurrency: 8,
          durationMs: Math.round(performance.now() - started),
          p50Ms: Math.round(latencies[19]),
          p95Ms: Math.round(latencies[37]),
          maxMs: Math.round(latencies[39]),
        }),
    );
    expect(latencies).toHaveLength(40);
  });
});
