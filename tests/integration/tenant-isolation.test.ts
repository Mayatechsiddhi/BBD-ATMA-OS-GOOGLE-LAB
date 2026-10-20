import { randomUUID, createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, type Prisma } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { adminDb as admin } from "../../scripts/local-admin-db";
import { db } from "../../src/lib/db";
import { withActor, assertRuntimeDatabase } from "../../src/lib/tenant-context";
import * as orgs from "../../src/modules/organizations/service";
import * as crm from "../../src/modules/crm/service";
const suffix = randomUUID();
const users = Array.from({ length: 4 }, () => randomUUID());
const [a, b, member, dual] = users;
const organizations: string[] = [];
let orgA: string,
  orgB: string,
  contactA: string,
  contactB: string,
  invitationB: string,
  hashB: string;
const single = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.RUNTIME_DATABASE_URL,
    max: 1,
  }),
});
async function denied(promise: Promise<unknown>) {
  try {
    await promise;
    throw new Error("Expected database denial");
  } catch (error) {
    const meta = (
      error as {
        meta?: {
          code?: string;
          driverAdapterError?: { cause?: { originalCode?: string } };
        };
      }
    ).meta;
    expect(meta?.code ?? meta?.driverAdapterError?.cause?.originalCode).toBe(
      "42501",
    );
  }
}
async function context(
  tx: Prisma.TransactionClient,
  user: string,
  organization: string,
) {
  await tx.$queryRaw`SELECT set_config('bbd.context_transaction',pg_current_xact_id()::text,true),set_config('bbd.actor_id',${user},true),set_config('bbd.organization_id',${organization},true),set_config('bbd.invitation_hash','',true)`;
}
beforeAll(async () => {
  await admin.user.createMany({
    data: users.map((id) => ({
      id,
      name: "RLS fixture",
      email: `rls-${id}@example.com`,
      emailVerified: true,
    })),
  });
  orgA = (
    await orgs.createOrganization(a, {
      name: "Isolation A",
      slug: `a-${suffix}`,
    })
  ).id;
  organizations.push(orgA);
  orgB = (
    await orgs.createOrganization(b, {
      name: "Isolation B",
      slug: `b-${suffix}`,
    })
  ).id;
  organizations.push(orgB);
  await admin.membership.createMany({
    data: [
      { organizationId: orgA, userId: member, role: "MEMBER" },
      { organizationId: orgA, userId: dual, role: "OWNER" },
      { organizationId: orgB, userId: dual, role: "OWNER" },
    ],
  });
  contactA = (
    await crm.createContact(a, orgA, {
      name: `A-${suffix}`,
      email: `a-${suffix}@example.com`,
    })
  ).id;
  contactB = (
    await crm.createContact(b, orgB, {
      name: `B-${suffix}`,
      email: `b-${suffix}@example.com`,
    })
  ).id;
  await orgs.createInvitation(a, orgA, {
    email: `rls-${b}@example.com`,
    role: "MEMBER",
  });
  const token = await orgs.createInvitation(b, orgB, {
    email: `rls-${a}@example.com`,
    role: "MEMBER",
  });
  hashB = createHash("sha256").update(token).digest("hex");
  invitationB = (
    await admin.invitation.findUniqueOrThrow({ where: { tokenHash: hashB } })
  ).id;
});
afterAll(async () => {
  await admin.organization.deleteMany({ where: { id: { in: organizations } } });
  await admin.user.deleteMany({ where: { id: { in: users } } });
  await single.$disconnect();
  await db.$disconnect();
  await admin.$disconnect();
});
describe("PostgreSQL tenant isolation under the actual unprivileged application role", () => {
  it("enforces role separation, FORCE RLS and schema privileges", async () => {
    await expect(assertRuntimeDatabase()).resolves.toBeUndefined();
    await expect(assertRuntimeDatabase(admin)).rejects.toThrow(
      "Unsafe runtime",
    );
    const [flags] = await db.$queryRaw<
      {
        super: boolean;
        bypass: boolean;
        create: boolean;
        privateCreate: boolean;
      }[]
    >`SELECT rolsuper AS super,rolbypassrls AS bypass,has_schema_privilege(current_user,'public','CREATE') AS create,has_schema_privilege(current_user,'bbd_private','CREATE') AS "privateCreate" FROM pg_roles WHERE rolname=current_user`;
    const tenantTables = await admin.$queryRaw<
      { relname: string; secure: boolean }[]
    >`SELECT DISTINCT c.relname,(c.relrowsecurity AND c.relforcerowsecurity) AS secure FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relkind='r' AND (a.attname='organizationId' OR c.relname='Organization') ORDER BY c.relname`;
    expect(tenantTables.map((t) => t.relname)).toEqual([
      "AuditEvent",
      "Contact",
      "Invitation",
      "Membership",
      "Organization",
    ]);
    expect(tenantTables.every((t) => t.secure)).toBe(true);
    const publicFunctions = await admin.$queryRaw<
      { proname: string }[]
    >`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE n.nspname='bbd_private' AND acl.grantee=0 AND acl.privilege_type='EXECUTE'`;
    expect(publicFunctions).toEqual([]);
    expect(flags).toEqual({
      super: false,
      bypass: false,
      create: false,
      privateCreate: false,
    });
    await denied(db.$executeRawUnsafe("SET ROLE bbd"));
    await denied(db.$queryRaw`SELECT * FROM public._prisma_migrations`);
    await denied(db.user.deleteMany({ where: { id: b } }));
  });
  it("hides every tenant-owned table without context; original owner credentials reproduce the bypass", async () => {
    await denied(
      db.$queryRaw`SELECT * FROM bbd_private.create_organization('unscoped-bootstrap','Denied','denied-unscoped')`,
    );
    await denied(
      db.organization.create({
        data: { name: "Denied", slug: "denied-direct" },
      }),
    );
    expect(await db.organization.findMany()).toEqual([]);
    expect(await db.membership.findMany()).toEqual([]);
    expect(await db.invitation.findMany()).toEqual([]);
    expect(await db.auditEvent.findMany()).toEqual([]);
    expect(await db.contact.findMany()).toEqual([]);
    // The original app used this privileged connection. It must now be rejected by the runtime guard.
    expect(
      (
        await admin.contact.findMany({
          where: { id: { in: [contactA, contactB] } },
        })
      ).length,
    ).toBe(2);
  });
  it("contains deliberately unscoped ORM queries and nested directory reads in tenant A", async () => {
    await withActor(
      a,
      async (tx) => {
        expect((await tx.contact.findMany()).map((r) => r.id)).toEqual([
          contactA,
        ]);
        expect((await tx.organization.findMany()).map((r) => r.id)).toEqual([
          orgA,
        ]);
        const members = await tx.membership.findMany({
          include: { user: { select: { email: true } } },
        });
        expect(members.length).toBe(3);
        expect(members.every((m) => m.organizationId === orgA)).toBe(true);
        expect(
          (await tx.invitation.findMany()).every(
            (i) => i.organizationId === orgA,
          ),
        ).toBe(true);
        const events = await tx.auditEvent.findMany();
        expect(events.length).toBeGreaterThan(0);
        expect(events.every((e) => e.organizationId === orgA)).toBe(true);
      },
      orgA,
    );
  });
  it("allows only own workspace discovery without selecting a tenant", async () => {
    await withActor(a, async (tx) => {
      expect((await tx.organization.findMany()).map((r) => r.id)).toEqual([
        orgA,
      ]);
      expect(
        (await tx.membership.findMany()).every((m) => m.userId === a),
      ).toBe(true);
      expect(await tx.contact.findMany()).toEqual([]);
      expect(await tx.auditEvent.findMany()).toEqual([]);
    });
  });
  it("denies a forged tenant selection when the authenticated actor has no membership", async () => {
    await withActor(
      a,
      async (tx) => {
        expect(await tx.organization.findMany()).toEqual([]);
        expect(await tx.membership.findMany()).toEqual([]);
        expect(await tx.invitation.findMany()).toEqual([]);
        expect(await tx.auditEvent.findMany()).toEqual([]);
        expect(await tx.contact.findMany()).toEqual([]);
      },
      orgB,
    );
    await denied(
      withActor(
        a,
        (tx) =>
          tx.contact.create({
            data: {
              organizationId: orgB,
              name: "Denied",
              email: "denied@example.com",
            },
          }),
        orgB,
      ),
    );
  });
  it("isolates search, aggregates and export-shaped SQL without caller tenant predicates", async () => {
    await withActor(
      a,
      async (tx) => {
        expect(
          await tx.contact.findMany({
            where: { name: { contains: `B-${suffix}` } },
          }),
        ).toEqual([]);
        expect(await tx.contact.count()).toBe(1);
        const [result] = await tx.$queryRaw<
          { rows: { id: string }[] }[]
        >`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id)), '[]'::jsonb) AS rows FROM public."Contact"`;
        expect(result.rows).toEqual([{ id: contactA }]);
      },
      orgA,
    );
  });
  it("blocks foreign updates and deletions even with known record identifiers", async () => {
    await withActor(
      a,
      async (tx) => {
        expect(
          (
            await tx.contact.updateMany({
              where: { id: contactB },
              data: { name: "Attack" },
            })
          ).count,
        ).toBe(0);
        expect(
          (
            await tx.organization.updateMany({
              where: { id: orgB },
              data: { name: "Attack" },
            })
          ).count,
        ).toBe(0);
        expect(
          (
            await tx.membership.updateMany({
              where: { organizationId: orgB },
              data: { role: "MEMBER" },
            })
          ).count,
        ).toBe(0);
        expect(
          (await tx.membership.deleteMany({ where: { organizationId: orgB } }))
            .count,
        ).toBe(0);
        expect(
          (await tx.invitation.deleteMany({ where: { id: invitationB } }))
            .count,
        ).toBe(0);
      },
      orgA,
    );
    expect(
      (await admin.contact.findUniqueOrThrow({ where: { id: contactB } })).name,
    ).toBe(`B-${suffix}`);
    expect(await admin.invitation.count({ where: { id: invitationB } })).toBe(
      1,
    );
  });
  it("prevents cross-context writes even for a user who belongs to both organizations", async () => {
    await denied(
      withActor(
        dual,
        (tx) =>
          tx.contact.create({
            data: {
              organizationId: orgB,
              name: "Wrong context",
              email: "wrong@example.com",
            },
          }),
        orgA,
      ),
    );
    await denied(
      withActor(
        dual,
        (tx) =>
          tx.contact.update({
            where: { id: contactA },
            data: { organizationId: orgB },
          }),
        orgA,
      ),
    );
    await denied(
      withActor(
        dual,
        (tx) =>
          tx.membership.update({
            where: {
              organizationId_userId: { organizationId: orgA, userId: member },
            },
            data: { organizationId: orgB },
          }),
        orgA,
      ),
    );
  });
  it("enforces read-only members and immutable audit records at the database boundary", async () => {
    await withActor(
      member,
      async (tx) => {
        expect(await tx.contact.count()).toBe(1);
        expect(
          (await tx.contact.updateMany({ data: { name: "Attack" } })).count,
        ).toBe(0);
      },
      orgA,
    );
    await denied(
      withActor(
        member,
        (tx) =>
          tx.contact.create({
            data: {
              organizationId: orgA,
              name: "Attack",
              email: "member@example.com",
            },
          }),
        orgA,
      ),
    );
    await denied(
      withActor(
        a,
        (tx) =>
          tx.auditEvent.create({
            data: { organizationId: orgA, actorId: b, action: "forged" },
          }),
        orgA,
      ),
    );
    await denied(
      withActor(
        a,
        (tx) => tx.auditEvent.updateMany({ data: { action: "tampered" } }),
        orgA,
      ),
    );
    await denied(withActor(a, (tx) => tx.auditEvent.deleteMany(), orgA));
    await denied(withActor(a, (tx) => tx.contact.deleteMany(), orgA));
    await denied(withActor(a, (tx) => tx.organization.deleteMany(), orgA));
  });
  it("limits invitation bootstrap to the verified addressed token and exact invited role", async () => {
    await withActor(
      member,
      async (tx) => {
        expect(await tx.invitation.findMany()).toEqual([]);
      },
      "",
      hashB,
    );
    await withActor(
      a,
      async (tx) => {
        expect((await tx.invitation.findMany()).map((i) => i.id)).toEqual([
          invitationB,
        ]);
        expect(await tx.contact.findMany()).toEqual([]);
      },
      "",
      hashB,
    );
    await denied(
      withActor(
        a,
        (tx) =>
          tx.membership.create({
            data: { organizationId: orgB, userId: a, role: "OWNER" },
          }),
        orgB,
        hashB,
      ),
    );
    await denied(
      withActor(
        b,
        (tx) =>
          tx.invitation.update({
            where: { id: invitationB },
            data: { email: "changed@example.com" },
          }),
        orgB,
      ),
    );
  });
  it("clears transaction context after commit and rollback on the same pooled connection", async () => {
    let pid: number | undefined;
    for (let index = 0; index < 6; index++) {
      const owner = index % 2 ? a : b,
        organization = index % 2 ? orgA : orgB,
        expected = index % 2 ? contactA : contactB;
      await single.$transaction(async (tx) => {
        await context(tx, owner, organization);
        const [p] = await tx.$queryRaw<
          { pid: number }[]
        >`SELECT pg_backend_pid() AS pid`;
        if (pid) expect(p.pid).toBe(pid);
        pid = p.pid;
        expect((await tx.contact.findMany()).map((r) => r.id)).toEqual([
          expected,
        ]);
      });
      expect(await single.contact.findMany()).toEqual([]);
    }
    await expect(
      single.$transaction(async (tx) => {
        await context(tx, a, orgA);
        expect(await tx.contact.count()).toBe(1);
        throw new Error("Deliberate rollback");
      }),
    ).rejects.toThrow("Deliberate rollback");
    expect(await single.contact.findMany()).toEqual([]);
  });
  it("rejects stale session-level settings on a reused pool connection", async () => {
    await single.$queryRaw`SELECT set_config('bbd.actor_id',${a},false),set_config('bbd.organization_id',${orgA},false),set_config('bbd.context_transaction',pg_current_xact_id()::text,false)`;
    expect(await single.contact.findMany()).toEqual([]);
    await single.$transaction(async (tx) => {
      await context(tx, b, orgB);
      expect((await tx.contact.findMany()).map((r) => r.id)).toEqual([
        contactB,
      ]);
    });
    expect(await single.contact.findMany()).toEqual([]);
    await single.$queryRaw`SELECT set_config('bbd.actor_id','',false),set_config('bbd.organization_id','',false),set_config('bbd.context_transaction','',false)`;
  });
  it("keeps concurrent tenant transactions isolated across the application pool", async () => {
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        withActor(
          i % 2 ? a : b,
          async (tx) => {
            await tx.$executeRaw`SELECT pg_sleep(0.01)`;
            expect((await tx.contact.findMany()).map((c) => c.id)).toEqual([
              i % 2 ? contactA : contactB,
            ]);
          },
          i % 2 ? orgA : orgB,
        ),
      ),
    );
  });
  it("allows an owner to leave while preserving another owner and the atomic audit trail", async () => {
    await orgs.changeMember(a, orgA, a, null);
    expect(
      await admin.membership.count({
        where: { organizationId: orgA, userId: a },
      }),
    ).toBe(0);
    expect(
      await admin.membership.count({
        where: { organizationId: orgA, role: "OWNER" },
      }),
    ).toBe(1);
    expect(
      await admin.auditEvent.count({
        where: {
          organizationId: orgA,
          actorId: a,
          action: "member.removed",
          subjectId: a,
        },
      }),
    ).toBe(1);
    await expect(orgs.getOrganization(a, orgA)).rejects.toThrow(
      "Access denied",
    );
  });
  it("preserves the old migrations and validates every applied migration checksum", async () => {
    const history = await admin.$queryRaw<
      { migration_name: string; checksum: string }[]
    >`SELECT migration_name,checksum FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    for (const dir of readdirSync("prisma/migrations", {
      withFileTypes: true,
    }).filter((d) => d.isDirectory())) {
      const expected = createHash("sha256")
        .update(readFileSync(`prisma/migrations/${dir.name}/migration.sql`))
        .digest("hex");
      expect(history.find((h) => h.migration_name === dir.name)?.checksum).toBe(
        expected,
      );
    }
  });
});
