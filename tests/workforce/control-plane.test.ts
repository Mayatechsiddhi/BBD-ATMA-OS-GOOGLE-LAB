import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, it } from "vitest";
import { hashPassword } from "better-auth/crypto";
import { PrismaClient } from "@/generated/workforce/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createWorkforceControlPlane } from "@/modules/workforce-control-plane/control";
import {
  workforceDatabase,
  assertWorkforceRuntime,
} from "@/modules/workforce-control-plane/database";
import { workforceIdentity } from "@/modules/workforce-control-plane/identity";
import { request } from "../fixtures/workforce";
for (const key of [
  "WORKFORCE_TEST_DATABASE_URL",
  "WORKFORCE_RUNTIME_DATABASE_URL",
]) {
  const url = new URL(process.env[key]!);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !/^\/bbd_workforce_[a-z0-9_]+_test$/.test(url.pathname)
  )
    throw Error("Isolated local workforce fixtures required");
}
const owner = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.WORKFORCE_TEST_DATABASE_URL!,
  }),
});
const runtime = workforceDatabase();
let a: Awaited<ReturnType<typeof createWorkforceControlPlane>>, b: typeof a;
const company = randomUUID(),
  foreign = randomUUID();
const ids = {
  requester: randomUUID(),
  approver: randomUUID(),
  founder: randomUUID(),
  executor: randomUUID(),
  other: randomUUID(),
};
const cookies = {} as Record<keyof typeof ids, Headers>;
const cmd = (t: { id: string; version: number; digest: string }) => ({
  taskId: t.id,
  expectedVersion: t.version,
  requestDigest: t.digest,
});
type Task = {
  id: string;
  version: number;
  digest: string;
  status: string;
  approvalState: string;
  attempts: number;
  approvalId: string;
  result: unknown;
  receipt: { id: string };
  receipts: { id: string; status: string }[];
};
async function act(
  role: keyof typeof ids,
  op: string,
  data: unknown,
  instance = a,
  scope = company,
) {
  return (await instance.command(cookies[role], scope, op, data)) as Task;
}
async function submitted(
  department: "ENGINEERING" | "OPERATIONS" = "ENGINEERING",
) {
  return act("requester", "submit", request(department, company));
}
async function approved(
  department: "ENGINEERING" | "OPERATIONS" = "ENGINEERING",
) {
  let task = await submitted(department);
  task = await act("approver", "approve", cmd(task));
  return act("founder", "founder-approve", cmd(task));
}
beforeAll(async () => {
  await owner.workforceCompany.createMany({
    data: [{ id: company }, { id: foreign }],
  });
  const password = `Synthetic-${randomUUID()}!`;
  const hashed = await hashPassword(password);
  const auth = workforceIdentity(runtime);
  for (const [role, id] of Object.entries(ids)) {
    const email = `wf-${id}@example.com`;
    await owner.user.create({
      data: { id, name: "Synthetic workforce", email, emailVerified: true },
    });
    await owner.account.create({
      data: {
        id: randomUUID(),
        userId: id,
        accountId: id,
        providerId: "credential",
        password: hashed,
      },
    });
    await owner.workforceMember.create({
      data: {
        companyId: role === "other" ? foreign : company,
        userId: id,
        role: role === "other" ? "REQUESTER" : role.toUpperCase(),
      },
    });
    const response = await auth.api.signInEmail({
      body: { email, password },
      headers: new Headers({
        origin: process.env.WORKFORCE_AUTH_URL!,
        "x-bbd-client-ip": `2001:db8:${id.slice(0, 4)}:${id.slice(4, 8)}::1`,
      }),
      asResponse: true,
    });
    expect(response.status).toBe(200);
    const cookie = response.headers
      .getSetCookie()
      .map((x) => x.split(";")[0])
      .join("; ");
    cookies[role as keyof typeof ids] = new Headers({ cookie });
  }
  a = await createWorkforceControlPlane();
  b = await createWorkforceControlPlane();
}, 30000);
afterAll(async () => {
  // Delete only this run's isolated synthetic company/user fixtures, as owner.
  await owner.workforceAudit.deleteMany({
    where: { companyId: { in: [company, foreign] } },
  });
  await owner.workforceReceipt.deleteMany({
    where: { companyId: { in: [company, foreign] } },
  });
  await owner.workforceTask.deleteMany({
    where: { companyId: { in: [company, foreign] } },
  });
  await owner.workforceMember.deleteMany({
    where: { companyId: { in: [company, foreign] } },
  });
  await owner.workforceCompany.deleteMany({
    where: { id: { in: [company, foreign] } },
  });
  await owner.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
  await Promise.all([
    a?.close(),
    b?.close(),
    owner.$disconnect(),
    runtime.$disconnect(),
  ]);
});
it("authenticates signed workforce sessions and denies forged identities/unknown fields", async () => {
  await expect(
    a.command(
      new Headers({ "x-user-id": ids.founder, "x-role": "FOUNDER" }),
      company,
      "pause",
      { expectedVersion: 0 },
    ),
  ).rejects.toThrow("ACCESS_DENIED");
  const forged = new Headers({
    cookie: "bbd-workforce.session_token=forged",
    "x-user-id": ids.founder,
  });
  await expect(a.command(forged, company, "audit", {})).rejects.toThrow(
    "ACCESS_DENIED",
  );
  await expect(
    act("requester", "submit", {
      ...request("ENGINEERING", company),
      actorId: ids.founder,
    }),
  ).rejects.toThrow();
});
it("rejects foreign-company reads and mutations with a known task ID", async () => {
  const task = await submitted();
  await expect(act("other", "read", { taskId: task.id })).rejects.toThrow();
  await expect(
    act("founder", "revoke", cmd(task), a, foreign),
  ).rejects.toThrow();
  await expect(
    act("other", "submit", request("ENGINEERING", company)),
  ).rejects.toThrow();
});
it("requires independent approver and Founder before executor claim", async () => {
  let task = await submitted();
  await expect(act("requester", "approve", cmd(task))).rejects.toThrow();
  await expect(act("founder", "founder-approve", cmd(task))).rejects.toThrow();
  task = await act("approver", "approve", cmd(task));
  await expect(act("executor", "claim", cmd(task))).rejects.toThrow();
  await expect(act("approver", "founder-approve", cmd(task))).rejects.toThrow();
  task = await act("founder", "founder-approve", cmd(task));
  await expect(act("founder", "claim", cmd(task))).rejects.toThrow();
  const claimed = await act("executor", "claim", cmd(task));
  const done = (await a.completeMock(cookies.executor, company, {
    ...cmd(claimed),
    receiptId: claimed.receipt.id,
  })) as Task;
  expect(done.status).toBe("DRAFT_READY");
  expect(done.result).toMatchObject({ mock: true, requiresHumanReview: true });
});
it("commits one durable claim across independent pools and rejects replayed completion", async () => {
  const task = await approved();
  const results = await Promise.allSettled([
    act("executor", "claim", cmd(task), a),
    act("executor", "claim", cmd(task), b),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const winner = results.find(
    (r) => r.status === "fulfilled",
  ) as PromiseFulfilledResult<Task>;
  expect(
    await owner.workforceReceipt.count({
      where: { companyId: company, taskId: task.id },
    }),
  ).toBe(1);
  const input = { ...cmd(winner.value), receiptId: winner.value.receipt.id };
  const finish = await Promise.allSettled([
    a.completeMock(cookies.executor, company, input),
    b.completeMock(cookies.executor, company, input),
  ]);
  expect(finish.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  await expect(act("executor", "claim", cmd(task))).rejects.toThrow();
});
it("persists submission idempotency and receipts across controller restart", async () => {
  const input = request("ENGINEERING", company);
  const task = await act("requester", "submit", input);
  const restarted = await createWorkforceControlPlane();
  try {
    expect((await act("requester", "submit", input, restarted)).id).toBe(
      task.id,
    );
    await expect(
      act("requester", "submit", { ...input, taskId: randomUUID() }, restarted),
    ).rejects.toThrow();
  } finally {
    await restarted.close();
  }
  expect(
    await owner.workforceAudit.count({
      where: { companyId: company, taskId: task.id, action: "task.submitted" },
    }),
  ).toBe(1);
});
it("rechecks digest/version, task expiry and approval expiry at claim", async () => {
  let task = await approved();
  await expect(
    act("executor", "claim", { ...cmd(task), requestDigest: "0".repeat(64) }),
  ).rejects.toThrow();
  await expect(
    act("executor", "claim", { ...cmd(task), expectedVersion: 0 }),
  ).rejects.toThrow();
  // Isolated fixture owner advances expiry, never production timeouts/source.
  await owner.workforceTask.update({
    where: { companyId_id: { companyId: company, id: task.id } },
    data: { approvalUntil: new Date(Date.now() - 1) },
  });
  await expect(act("executor", "claim", cmd(task))).rejects.toThrow();
  task = await approved();
  await owner.workforceTask.update({
    where: { companyId_id: { companyId: company, id: task.id } },
    data: { expiresAt: new Date(Date.now() - 1) },
  });
  await expect(act("executor", "claim", cmd(task))).rejects.toThrow();
});
it("serializes revocation races and never exposes a result after revocation wins", async () => {
  const approvedTask = await approved();
  const race = await Promise.allSettled([
    act("executor", "claim", cmd(approvedTask), a),
    act("founder", "revoke", cmd(approvedTask), b),
  ]);
  const claimed =
    race[0].status === "fulfilled"
      ? (race[0] as PromiseFulfilledResult<Task>).value
      : null;
  if (claimed) {
    const revoked = await act("founder", "revoke", cmd(claimed));
    expect(revoked.status).toBe("CANCELLED");
    await expect(
      a.completeMock(cookies.executor, company, {
        ...cmd(claimed),
        receiptId: claimed.receipt.id,
      }),
    ).rejects.toThrow();
  } else expect(race[1].status).toBe("fulfilled");
  const task = await act("founder", "read", { taskId: approvedTask.id });
  expect(task.result).toBeNull();
  expect(task.status).toBe("CANCELLED");
  expect(task.receipts.every((r) => r.status === "CANCELLED")).toBe(true);
});
it("persists pause across instances, permits revoke while paused, requires versioned Founder resume", async () => {
  const task = await approved();
  const c = await owner.workforceCompany.findUniqueOrThrow({
    where: { id: company },
  });
  await expect(
    act("approver", "pause", { expectedVersion: c.version }),
  ).rejects.toThrow();
  await act("founder", "pause", { expectedVersion: c.version });
  await expect(act("executor", "claim", cmd(task), b)).rejects.toThrow();
  await act("founder", "revoke", cmd(task), b);
  await expect(
    act("founder", "resume", { expectedVersion: c.version }),
  ).rejects.toThrow();
  await act("founder", "resume", { expectedVersion: c.version + 1 });
});
it("uses deterministic Operations transient failure with explicit bounded retry", async () => {
  let task = await approved("OPERATIONS");
  task = await act("executor", "claim", cmd(task));
  task = (await a.completeMock(cookies.executor, company, {
    ...cmd(task),
    receiptId: task.receipt.id,
  })) as Task;
  expect(task.status).toBe("RETRYABLE_FAILURE");
  task = await act("executor", "retry", cmd(task));
  task = await act("executor", "claim", cmd(task));
  task = (await a.completeMock(cookies.executor, company, {
    ...cmd(task),
    receiptId: task.receipt.id,
  })) as Task;
  expect(task.status).toBe("DRAFT_READY");
  expect(task.attempts).toBe(2);
  await expect(act("executor", "retry", cmd(task))).rejects.toThrow();
});
it("rolls back task/receipt if the transactional audit append fails", async () => {
  const task = await approved();
  // Owner-only trigger on a separate synthetic company/task, always removed.
  await owner.$executeRawUnsafe(
    `CREATE FUNCTION wf_private.fixture_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."taskId"='${task.id}'::uuid AND NEW.action='task.claimed' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`,
  );
  await owner.$executeRawUnsafe(
    `CREATE TRIGGER fixture_fail_audit BEFORE INSERT ON "WorkforceAudit" FOR EACH ROW EXECUTE FUNCTION wf_private.fixture_fail_audit()`,
  );
  try {
    await expect(act("executor", "claim", cmd(task))).rejects.toThrow();
  } finally {
    await owner.$executeRawUnsafe(
      'DROP TRIGGER fixture_fail_audit ON "WorkforceAudit"',
    );
    await owner.$executeRawUnsafe(
      "DROP FUNCTION wf_private.fixture_fail_audit()",
    );
  }
  expect((await act("founder", "read", { taskId: task.id })).status).toBe(
    "QUEUED",
  );
  expect(
    await owner.workforceReceipt.count({
      where: { companyId: company, taskId: task.id },
    }),
  ).toBe(0);
});
it("enforces FORCE RLS without context and across pooled transaction rollback", async () => {
  expect(await runtime.workforceTask.findMany()).toEqual([]);
  await expect(
    runtime.workforceTask.updateMany({ data: { status: "DRAFT_READY" } }),
  ).rejects.toThrow();
  await expect(
    runtime.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('wf.transaction',pg_current_xact_id()::text,true),set_config('wf.actor',${ids.founder},true),set_config('wf.company',${company},true)`;
      expect(await tx.workforceTask.findMany()).toEqual([]);
      throw Error("rollback");
    }),
  ).rejects.toThrow("rollback");
  const liveSession = await owner.session.findFirstOrThrow({
    where: { userId: ids.founder },
  });
  await runtime.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('wf.transaction',pg_current_xact_id()::text,true),set_config('wf.actor',${ids.founder},true),set_config('wf.session',${liveSession.id},true),set_config('wf.company',${company},true)`;
    const own = await tx.workforceTask.findMany();
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((task) => task.companyId === company)).toBe(true);
    expect(
      await tx.workforceTask.findMany({ where: { companyId: foreign } }),
    ).toEqual([]);
  });
  expect(await runtime.workforceTask.findMany()).toEqual([]);
  const [inventory] = await runtime.$queryRaw<
    { customer: boolean }[]
  >`SELECT to_regclass('public."Contact"') IS NOT NULL AS customer`;
  expect(inventory.customer).toBe(false);
});
it("rejects runtime role/grant drift and direct business/audit/receipt mutations", async () => {
  await runtime.$transaction(assertWorkforceRuntime);
  for (const table of [
    "WorkforceCompany",
    "WorkforceMember",
    "WorkforceTask",
    "WorkforceReceipt",
    "WorkforceAudit",
  ]) {
    await expect(
      runtime.$executeRawUnsafe(`TRUNCATE "${table}"`),
    ).rejects.toThrow();
    await expect(
      runtime.$executeRawUnsafe(`DELETE FROM "${table}"`),
    ).rejects.toThrow();
  }
});
it("allows exactly one claim from two distinct worker OS processes with no customer credentials", async () => {
  const task = await approved();
  const execute = () =>
    new Promise<{ ok: boolean }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "scripts/workforce/claim-fixture.ts"],
        {
          env: {
            PATH: process.env.PATH,
            NODE_ENV: "test",
            WORKFORCE_RUNTIME_DATABASE_URL:
              process.env.WORKFORCE_RUNTIME_DATABASE_URL,
            WORKFORCE_AUTH_URL: process.env.WORKFORCE_AUTH_URL,
            WORKFORCE_AUTH_SECRET: process.env.WORKFORCE_AUTH_SECRET,
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let output = "";
      child.stdout.on("data", (chunk) => (output += chunk));
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code !== 0)
          reject(Error("Fixture child failed; private diagnostics withheld"));
        else resolve(JSON.parse(output));
      });
      child.stdin.end(
        JSON.stringify({
          company,
          cookie: cookies.executor.get("cookie"),
          command: cmd(task),
        }),
      );
    });
  const results = await Promise.all([execute(), execute()]);
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(
    await owner.workforceReceipt.count({
      where: { companyId: company, taskId: task.id },
    }),
  ).toBe(1);
});
it("serializes completion/revocation races and preserves final cancellation and receipts", async () => {
  let task = await approved();
  task = await act("executor", "claim", cmd(task));
  const race = await Promise.allSettled([
    a.completeMock(cookies.executor, company, {
      ...cmd(task),
      receiptId: task.receipt.id,
    }),
    act("founder", "revoke", cmd(task), b),
  ]);
  const fresh = await act("founder", "read", { taskId: task.id });
  if (fresh.status !== "CANCELLED") await act("founder", "revoke", cmd(fresh));
  const final = await act("founder", "read", { taskId: task.id });
  expect(final.status).toBe("CANCELLED");
  expect(final.result).toBeNull();
  expect(final.receipts[0].status).toBe("CANCELLED");
  expect(race.some((r) => r.status === "fulfilled")).toBe(true);
});
it("rejects direct malformed payloads with otherwise valid transaction/session context", async () => {
  const session = await owner.session.findFirstOrThrow({
    where: { userId: ids.requester },
  });
  const unsafe = {
    ...request("ENGINEERING", company),
    credentials: "never-store-this",
  };
  await expect(
    runtime.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('wf.transaction',pg_current_xact_id()::text,true),set_config('wf.actor',${ids.requester},true),set_config('wf.session',${session.id},true),set_config('wf.company',${company},true)`;
      await tx.$queryRaw`SELECT wf_private.dispatch('submit',${company}::uuid,${JSON.stringify({ request: unsafe, digest: "a".repeat(64) })}::jsonb)`;
    }),
  ).rejects.toThrow();
  expect(
    await owner.workforceTask.count({ where: { id: unsafe.taskId } }),
  ).toBe(0);
});
it("fails readiness on excessive and missing grants, restoring only this fixture change", async () => {
  const role = process.env.WORKFORCE_TEST_RUNTIME_ROLE!;
  if (!/^bbd_workforce_[a-z0-9_]+_test_runtime$/.test(role))
    throw Error("Fixture role required");
  await runtime.$transaction(assertWorkforceRuntime);
  await owner.$executeRawUnsafe(
    `GRANT TRUNCATE ON "WorkforceTask" TO "${role}"`,
  );
  try {
    await expect(
      runtime.$transaction(assertWorkforceRuntime),
    ).rejects.toThrow();
  } finally {
    await owner.$executeRawUnsafe(
      `REVOKE TRUNCATE ON "WorkforceTask" FROM "${role}"`,
    );
  }
  await owner.$executeRawUnsafe(
    `REVOKE SELECT ON "WorkforceReceipt" FROM "${role}"`,
  );
  try {
    await expect(
      runtime.$transaction(assertWorkforceRuntime),
    ).rejects.toThrow();
  } finally {
    await owner.$executeRawUnsafe(
      `GRANT SELECT ON "WorkforceReceipt" TO "${role}"`,
    );
  }
  await owner.$executeRawUnsafe(
    `GRANT SELECT (id) ON "WorkforceTask" TO "${role}" WITH GRANT OPTION`,
  );
  try {
    await expect(
      runtime.$transaction(assertWorkforceRuntime),
    ).rejects.toThrow();
  } finally {
    await owner.$executeRawUnsafe(
      `REVOKE SELECT (id) ON "WorkforceTask" FROM "${role}"`,
    );
  }
  await runtime.$transaction(assertWorkforceRuntime);
});
it("denies expired and paused retries, including cross-instance pause state", async () => {
  let task = await approved("OPERATIONS");
  task = await act("executor", "claim", cmd(task));
  task = (await a.completeMock(cookies.executor, company, {
    ...cmd(task),
    receiptId: task.receipt.id,
  })) as Task;
  const c = await owner.workforceCompany.findUniqueOrThrow({
    where: { id: company },
  });
  await act("founder", "pause", { expectedVersion: c.version });
  await expect(act("executor", "retry", cmd(task), b)).rejects.toThrow();
  await act("founder", "resume", { expectedVersion: c.version + 1 });
  await owner.workforceTask.update({
    where: { companyId_id: { companyId: company, id: task.id } },
    data: { approvalUntil: new Date(Date.now() - 1) },
  });
  await expect(act("executor", "retry", cmd(task), b)).rejects.toThrow();
  expect((await act("founder", "read", { taskId: task.id })).attempts).toBe(1);
});
it("permits the same task UUID in separate companies without cross-company updates or inference", async () => {
  const input = request("ENGINEERING", company);
  let task = await act("requester", "submit", input);
  const foreignTask = await act(
    "other",
    "submit",
    { ...request("ENGINEERING", foreign), taskId: input.taskId },
    a,
    foreign,
  );
  task = await act("approver", "approve", cmd(task));
  expect(
    (await act("other", "read", { taskId: foreignTask.id }, a, foreign))
      .version,
  ).toBe(0);
  expect((await act("founder", "read", { taskId: task.id })).version).toBe(1);
});
it("refuses changed approver versions at dispatch even when the approval has not expired", async () => {
  const task = await approved();
  await owner.workforceMember.update({
    where: { companyId_userId: { companyId: company, userId: ids.approver } },
    data: { version: { increment: 1 } },
  });
  try {
    await expect(act("executor", "claim", cmd(task))).rejects.toThrow();
  } finally {
    await owner.workforceMember.update({
      where: { companyId_userId: { companyId: company, userId: ids.approver } },
      data: { version: 0 },
    });
  }
  expect((await act("founder", "read", { taskId: task.id })).attempts).toBe(0);
});
it("exhausts a one-attempt retry budget without creating a success result", async () => {
  const input = request("OPERATIONS", company);
  input.limits.maxAttempts = 1;
  let task = await act("requester", "submit", input);
  task = await act("approver", "approve", cmd(task));
  task = await act("founder", "founder-approve", cmd(task));
  task = await act("executor", "claim", cmd(task));
  task = (await a.completeMock(cookies.executor, company, {
    ...cmd(task),
    receiptId: task.receipt.id,
  })) as Task;
  expect(task.status).toBe("FAILED");
  expect(task.result).toBeNull();
  await expect(act("executor", "retry", cmd(task))).rejects.toThrow();
  expect(
    await owner.workforceReceipt.count({
      where: { companyId: company, taskId: task.id },
    }),
  ).toBe(1);
});
it("rejects migration-owner credentials as workforce runtime without authentication queries", async () => {
  const saved = process.env.WORKFORCE_RUNTIME_DATABASE_URL;
  process.env.WORKFORCE_RUNTIME_DATABASE_URL =
    process.env.WORKFORCE_TEST_DATABASE_URL;
  try {
    await expect(createWorkforceControlPlane()).rejects.toThrow(
      "Unsafe workforce runtime database",
    );
  } finally {
    process.env.WORKFORCE_RUNTIME_DATABASE_URL = saved;
  }
});
it("rechecks session revocation and principal revocation before the next action", async () => {
  const task = await approved();
  await act("other", "submit", request("ENGINEERING", foreign), a, foreign);
  await owner.session.deleteMany({ where: { userId: ids.other } });
  await expect(
    act("other", "submit", request("ENGINEERING", foreign), a, foreign),
  ).rejects.toThrow();
  await act("founder", "disable-member", {
    userId: ids.executor,
    expectedVersion: 0,
  });
  await expect(act("executor", "claim", cmd(task), b)).rejects.toThrow();
});
