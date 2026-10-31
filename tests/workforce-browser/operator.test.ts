import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { beforeAll, afterAll, expect, it } from "vitest";
import { chromium, type Browser } from "playwright-core";
import { hashPassword } from "better-auth/crypto";
import { PrismaClient } from "@/generated/workforce/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { workforceDatabase } from "@/modules/workforce-control-plane/database";
import { workforceIdentity } from "@/modules/workforce-control-plane/identity";
import { createWorkforceControlPlane } from "@/modules/workforce-control-plane/control";
import { request } from "../fixtures/workforce";
const owner = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.WORKFORCE_TEST_DATABASE_URL!,
  }),
});
const runtime = workforceDatabase();
const companies = [randomUUID(), randomUUID()];
const users = ["REQUESTER", "APPROVER", "FOUNDER", "EXECUTOR", "REQUESTER"].map(
  (role) => ({ id: randomUUID(), role }),
);
const password = `Synthetic-${randomUUID()}!`;
const origin = process.env.WORKFORCE_AUTH_URL!;
const cookies: Headers[] = [];
const diagnostic = fs.mkdtempSync("/tmp/bbd-browser-operator-");
fs.chmodSync(diagnostic, 0o700);
let control: Awaited<ReturnType<typeof createWorkforceControlPlane>>;
let child: ChildProcess, browser: Browser, task: string, foreignTask: string;
const errors: string[] = [];
let before: { tasks: unknown; receipts: unknown; audit: unknown };
async function records() {
  return {
    tasks: await owner.workforceTask.findMany({
      where: { companyId: { in: companies } },
      orderBy: { id: "asc" },
    }),
    receipts: await owner.workforceReceipt.findMany({
      where: { companyId: { in: companies } },
      orderBy: { id: "asc" },
    }),
    audit: await owner.workforceAudit.findMany({
      where: { companyId: { in: companies } },
      orderBy: { id: "asc" },
    }),
  };
}
beforeAll(async () => {
  await owner.workforceCompany.createMany({
    data: companies.map((id) => ({ id })),
  });
  const hash = await hashPassword(password),
    auth = workforceIdentity(runtime);
  for (const [i, user] of users.entries()) {
    const email = `operator-${user.id}@example.com`;
    await owner.user.create({
      data: {
        id: user.id,
        name: "Synthetic operator",
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
        companyId: companies[i === 4 ? 1 : 0],
        userId: user.id,
        role: user.role,
      },
    });
    const response = await auth.api.signInEmail({
      body: { email, password },
      headers: new Headers({
        origin,
        "x-bbd-client-ip": `2001:db8:${i + 410}:1::1`,
      }),
      asResponse: true,
    });
    expect(response.status).toBe(200);
    cookies.push(
      new Headers({
        cookie: response.headers
          .getSetCookie()
          .map((c) => c.split(";")[0])
          .join("; "),
      }),
    );
  }
  control = await createWorkforceControlPlane();
  let t = (await control.command(
    cookies[0],
    companies[0],
    "submit",
    request("ENGINEERING", companies[0]),
  )) as { id: string; version: number; digest: string };
  task = t.id;
  for (const [i, operation] of [
    [1, "approve"],
    [2, "founder-approve"],
    [3, "claim"],
  ] as const)
    t = (await control.command(cookies[i], companies[0], operation, {
      taskId: t.id,
      expectedVersion: t.version,
      requestDigest: t.digest,
    })) as typeof t;
  // Simulate a persisted old claim; do not execute a mock or reclaim it.
  await owner.workforceReceipt.updateMany({
    where: { companyId: companies[0], taskId: task },
    data: { createdAt: new Date(Date.now() - 180000) },
  });
  foreignTask = (
    (await control.command(
      cookies[4],
      companies[1],
      "submit",
      request("OPERATIONS", companies[1]),
    )) as { id: string }
  ).id;
  before = await records();
  const log = fs.openSync(`${diagnostic}/server.log`, "a", 0o600);
  child = spawn("node", ["--import", "tsx", "scripts/workforce/operator.tsx"], {
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "test",
      BBD_WORKFORCE_OPERATOR_LOCAL: "1",
      WORKFORCE_RUNTIME_DATABASE_URL:
        process.env.WORKFORCE_RUNTIME_DATABASE_URL,
      WORKFORCE_AUTH_SECRET: process.env.WORKFORCE_AUTH_SECRET,
      WORKFORCE_AUTH_URL: origin,
    },
    stdio: ["ignore", log, log],
  });
  fs.closeSync(log);
  await new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 10000;
    const poll = async () => {
      if (child.exitCode !== null)
        return reject(Error("Operator startup failed; inspect private log"));
      try {
        if ((await fetch(origin)).status === 200) return resolve();
      } catch {}
      if (Date.now() > deadline)
        return reject(Error("Operator startup deadline exceeded"));
      setTimeout(() => {
        void poll();
      }, 100);
    };
    void poll();
  });
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
    headless: true,
  });
}, 30000);
afterAll(async () => {
  await browser?.close();
  if (child?.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
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
    control?.close(),
    runtime.$disconnect(),
    owner.$disconnect(),
  ]);
});
async function context(role?: number, expectedDenials: string[] = []) {
  const ctx = await browser.newContext();
  await ctx.tracing.start({ screenshots: true, snapshots: true });
  if (role !== undefined)
    await ctx.addCookies(
      cookies[role]
        .get("cookie")!
        .split("; ")
        .map((c) => {
          const i = c.indexOf("=");
          return {
            name: c.slice(0, i),
            value: c.slice(i + 1),
            url: origin,
            httpOnly: true,
            sameSite: "Lax" as const,
          };
        }),
    );
  await ctx.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort(),
  );
  const page = await ctx.newPage();
  page.on("pageerror", () => errors.push("pageerror"));
  page.on("console", (m) => {
    if (m.type() === "error") {
      const expected404 =
        expectedDenials.includes(m.location().url) &&
        m.text() ===
          "Failed to load resource: the server responded with a status of 404 (Not Found)";
      if (!expected404) errors.push(`console-error: ${m.text()}`);
    }
  });
  return {
    ctx,
    page,
    close: async (label: string) => {
      await page.screenshot({
        path: `${diagnostic}/${label}.png`,
        fullPage: true,
      });
      await ctx.tracing.stop({ path: `${diagnostic}/${label}.zip` });
      await ctx.close();
    },
  };
}
it("authenticates through the real CSRF-protected sign-in form and renders scoped records", async () => {
  const { page, close } = await context(undefined, [
    `${origin}/?company=${companies[0]}`,
  ]);
  try {
    const denied = await page.goto(`${origin}/?company=${companies[0]}`);
    expect(denied?.status()).toBe(404);
    await page.goto(`${origin}/sign-in`);
    await page
      .getByLabel("Email", { exact: true })
      .fill(`operator-${users[2].id}@example.com`);
    await page.getByLabel("Password", { exact: true }).fill(password);
    const [signIn] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url() === `${origin}/sign-in` && r.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Sign in", exact: true }).click(),
    ]);
    expect(signIn.status()).toBe(303);
    await page.waitForURL(`${origin}/`);
    await page.getByLabel("Company ID").fill(companies[0]);
    await Promise.all([
      page.waitForURL((u) => u.searchParams.get("company") === companies[0]),
      page.getByRole("button", { name: "View records" }).click(),
    ]);
    expect(await page.locator("body").innerText()).toContain("Role FOUNDER");
    expect(await page.locator("body").innerText()).toContain(task);
  } finally {
    await close("login");
  }
});
it("shows stale claims as unknown, receipts and honest evidence without sensitive payloads", async () => {
  const { page, close } = await context(2);
  try {
    expect(
      (
        await page.goto(`${origin}/?company=${companies[0]}&task=${task}`)
      )?.status(),
    ).toBe(200);
    const body = await page.locator("body").innerText();
    expect(body).toContain("Stale claim — outcome unknown");
    expect(body).toContain("Execution receipts");
    expect(body).toContain("No task-specific test evidence recorded");
    expect(body).toContain("task.claimed");
    for (const u of users) expect(body).not.toContain(u.id);
    expect(body).not.toMatch(
      /example.com|Synthetic-|inputArtifact|session_token/,
    );
    expect(await page.locator('form[method="post"]').count()).toBe(0);
    expect(await page.locator("script").count()).toBe(0);
    expect(await page.getByRole("button").allTextContents()).toEqual([
      "View records",
    ]);
  } finally {
    await close("stale-claim");
  }
});
it("rejects foreign company/task navigation and restricts requester/executor audit access", async () => {
  for (const role of [0, 3]) {
    const { page, close } = await context(role, [
      `${origin}/?company=${companies[1]}`,
      `${origin}/?company=${companies[0]}&task=${foreignTask}`,
    ]);
    try {
      await page.goto(`${origin}/?company=${companies[0]}`);
      expect(await page.locator("body").innerText()).toContain(
        "Audit access restricted",
      );
      expect(
        (await page.goto(`${origin}/?company=${companies[1]}`))?.status(),
      ).toBe(404);
      expect(
        (
          await page.goto(
            `${origin}/?company=${companies[0]}&task=${foreignTask}`,
          )
        )?.status(),
      ).toBe(404);
    } finally {
      await close(`isolation-${role}`);
    }
  }
});
it("rejects CSRF, forged ingress, writes and unrecognized endpoints without business side effects", async () => {
  expect(
    (
      await fetch(`${origin}/sign-in`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "https://evil.example",
        },
        body: "email=synthetic%40example.com&password=not-real",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await fetch(`${origin}/sign-in`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: origin,
        },
        body:
          "csrf=" +
          "0".repeat(64) +
          "&email=synthetic%40example.com&password=not-real",
      })
    ).status,
  ).toBe(403);
  expect(
    (await fetch(origin, { headers: { "x-forwarded-for": "127.0.0.1" } }))
      .status,
  ).toBe(403);
  for (const p of [
    "/claim",
    "/api/workforce",
    "/internal/auth/sign-up/email",
  ]) {
    expect((await fetch(origin + p)).status).toBe(404);
    expect((await fetch(origin + p, { method: "POST" })).status).toBe(405);
  }
  expect(
    (await fetch(`${origin}/?company=${companies[0]}&actorId=${users[2].id}`))
      .status,
  ).toBe(400);
  const response = await fetch(origin);
  expect(response.headers.get("content-security-policy")).toContain(
    "script-src 'none'",
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await records()).toEqual(before);
});
it("renders without JavaScript on narrow screens with no application errors", async () => {
  const ctx = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 375, height: 812 },
  });
  const cookie = cookies[2].get("cookie")!;
  await ctx.setExtraHTTPHeaders({ cookie });
  const page = await ctx.newPage();
  try {
    await page.goto(`${origin}/?company=${companies[0]}&task=${task}`);
    expect(await page.locator("body").innerText()).toContain("Task detail");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(await page.locator('link[rel="stylesheet"]').count()).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});
