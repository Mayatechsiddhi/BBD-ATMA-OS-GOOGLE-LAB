import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, it } from "vitest";
import { hashPassword } from "better-auth/crypto";
import { PrismaClient } from "@/generated/workforce/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { workforceDatabase } from "@/modules/workforce-control-plane/database";
import { workforceIdentity } from "@/modules/workforce-control-plane/identity";
import { createWorkforceReader } from "@/modules/workforce-control-plane/reader";
import { createWorkforceControlPlane } from "@/modules/workforce-control-plane/control";
import { request } from "../fixtures/workforce";
const owner = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.WORKFORCE_TEST_DATABASE_URL!,
  }),
});
const runtime = workforceDatabase();
const companies = [randomUUID(), randomUUID()];
const users = [
  "REQUESTER",
  "REQUESTER",
  "APPROVER",
  "FOUNDER",
  "EXECUTOR",
  "REQUESTER",
].map((role) => ({ id: randomUUID(), role }));
const cookies: Headers[] = [];
let reader: Awaited<ReturnType<typeof createWorkforceReader>>;
let control: Awaited<ReturnType<typeof createWorkforceControlPlane>>;
let task: string, otherTask: string, foreignTask: string;
beforeAll(async () => {
  const u = new URL(process.env.WORKFORCE_TEST_DATABASE_URL!);
  if (
    !["localhost", "127.0.0.1"].includes(u.hostname) ||
    !u.pathname.endsWith("_test")
  )
    throw Error("Local fixture only");
  await owner.workforceCompany.createMany({
    data: companies.map((id) => ({ id })),
  });
  const password = `Synthetic-${randomUUID()}!`,
    hash = await hashPassword(password);
  const auth = workforceIdentity(runtime);
  for (const [i, user] of users.entries()) {
    const email = `reader-${user.id}@example.com`;
    await owner.user.create({
      data: {
        id: user.id,
        name: "Synthetic reader",
        email,
        emailVerified: true,
      },
    });
    await owner.account.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: hash,
      },
    });
    await owner.workforceMember.create({
      data: {
        companyId: companies[i === 5 ? 1 : 0],
        userId: user.id,
        role: user.role,
      },
    });
    const res = await auth.api.signInEmail({
      body: { email, password },
      headers: new Headers({
        origin: process.env.WORKFORCE_AUTH_URL!,
        "x-bbd-client-ip": `2001:db8:${i + 310}:1::1`,
      }),
      asResponse: true,
    });
    expect(res.status).toBe(200);
    cookies.push(
      new Headers({
        cookie: res.headers
          .getSetCookie()
          .map((c) => c.split(";")[0])
          .join("; "),
      }),
    );
  }
  reader = await createWorkforceReader();
  control = await createWorkforceControlPlane();
  for (const [i, key] of [
    [0, "own"],
    [1, "other"],
    [5, "foreign"],
  ] as const) {
    const t = (await control.command(
      cookies[i],
      companies[i === 5 ? 1 : 0],
      "submit",
      request("ENGINEERING", companies[i === 5 ? 1 : 0]),
    )) as { id: string };
    if (key === "own") task = t.id;
    else if (key === "other") otherTask = t.id;
    else foreignTask = t.id;
  }
}, 30000);
afterAll(async () => {
  const where = { companyId: { in: companies } };
  await owner.workforceAudit.deleteMany({ where });
  await owner.workforceReceipt.deleteMany({ where });
  await owner.workforceTask.deleteMany({ where });
  await owner.workforceMember.deleteMany({ where });
  await owner.workforceCompany.deleteMany({ where: { id: { in: companies } } });
  await owner.user.deleteMany({
    where: { id: { in: users.map((u) => u.id) } },
  });
  await Promise.all([
    reader?.close(),
    control?.close(),
    runtime.$disconnect(),
    owner.$disconnect(),
  ]);
});
const read = (i: number, extra = {}) =>
  reader.snapshot(cookies[i], { companyId: companies[0], ...extra });
it("denies missing/forged sessions and cross-company scope/detail without trusting actor IDs", async () => {
  for (const h of [
    new Headers(),
    new Headers({
      cookie: "bbd-workforce.session_token=forged",
      "x-user-id": users[3].id,
      "x-role": "FOUNDER",
    }),
  ])
    await expect(
      reader.snapshot(h, { companyId: companies[0] }),
    ).rejects.toThrow("ACCESS_DENIED");
  await expect(
    reader.snapshot(cookies[0], { companyId: companies[1] }),
  ).rejects.toThrow("ACCESS_DENIED");
  await expect(read(3, { taskId: foreignTask })).rejects.toThrow(
    "ACCESS_DENIED",
  );
  await expect(read(0, { actorId: users[3].id })).rejects.toThrow();
});
it("enforces requester ownership and company approver/founder/executor read permissions", async () => {
  const own = await read(0);
  expect(own.tasks.map((t) => t.id)).toEqual([task]);
  expect(own.canAudit).toBe(false);
  expect(own.audit).toEqual([]);
  await expect(read(0, { taskId: otherTask })).rejects.toThrow("ACCESS_DENIED");
  for (const i of [2, 3, 4]) expect((await read(i)).tasks).toHaveLength(2);
  expect((await read(2)).canAudit).toBe(true);
  expect((await read(3)).audit.length).toBeGreaterThan(0);
  expect((await read(4)).audit).toEqual([]);
});
it("projects private data and audits safely without changing task/receipt/audit state", async () => {
  const before = await owner.workforceTask.findMany({
    where: { companyId: companies[0] },
  });
  const audit = await owner.workforceAudit.count({
    where: { companyId: companies[0] },
  });
  const view = await read(3, { taskId: task });
  expect(view.selected?.evidence).toContain("No task-specific test evidence");
  expect(view.audit.map((a) => a.id)).toEqual(
    view.audit.map((_, i) => String(i + 1)),
  );
  const serialized = JSON.stringify(view);
  for (const u of users) expect(serialized).not.toContain(u.id);
  expect(serialized).not.toMatch(
    /password|session_token|inputArtifact|markdown-draft|example.com/,
  );
  expect(
    await owner.workforceTask.findMany({ where: { companyId: companies[0] } }),
  ).toEqual(before);
  expect(
    await owner.workforceAudit.count({ where: { companyId: companies[0] } }),
  ).toBe(audit);
});
it("rechecks membership revocation, unverified users and expired sessions", async () => {
  await owner.workforceMember.update({
    where: {
      companyId_userId: { companyId: companies[0], userId: users[1].id },
    },
    data: { active: false },
  });
  await expect(read(1)).rejects.toThrow("ACCESS_DENIED");
  await owner.user.update({
    where: { id: users[2].id },
    data: { emailVerified: false },
  });
  await expect(read(2)).rejects.toThrow("ACCESS_DENIED");
  await owner.session.updateMany({
    where: { userId: users[4].id },
    data: { expiresAt: new Date(0) },
  });
  await expect(read(4)).rejects.toThrow("ACCESS_DENIED");
});
it("bounds pagination and denies foreign task selectors and rejects noncanonical UUID scope", async () => {
  const data = Array.from({ length: 51 }, () => {
    const r = request("ENGINEERING", companies[0]);
    return {
      id: r.taskId,
      companyId: companies[0],
      correlationId: r.correlationId,
      department: "ENGINEERING",
      request: JSON.parse(JSON.stringify(r)),
      digest: "0".repeat(64),
      submittedBy: users[0].id,
      expiresAt: new Date(r.expiresAt),
    };
  });
  await owner.workforceTask.createMany({ data });
  const first = await read(3);
  expect(first.tasks).toHaveLength(50);
  expect(first.next).toBeTruthy();
  const next = await read(3, { after: first.next });
  expect(next.tasks).toHaveLength(3);
  expect(next.next).toBeNull();
  expect(next.tasks.some((t) => first.tasks.some((f) => f.id === t.id))).toBe(
    false,
  );
  await expect(
    reader.snapshot(cookies[3], { companyId: companies[0].toUpperCase() }),
  ).rejects.toThrow("canonical lowercase");
});
