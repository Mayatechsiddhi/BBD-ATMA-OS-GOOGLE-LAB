import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";
import { browserSourceGuard } from "./browser-diagnostics";
import { adminDb } from "./local-admin-db";
import { browserClientIP } from "./browser-client-ip";
import { verifyFixtureEmail } from "./browser-verification";
const base = process.env.BETTER_AUTH_URL!;
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
assert.ok(new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"));
const assertStable = browserSourceGuard();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  headless: true,
});
const run = randomUUID(),
  users: string[] = [];
try {
  for (let index = 1; index <= 6; index++) {
    const context = await browser.newContext({
      baseURL: base,
      extraHTTPHeaders: {
        Origin: base,
        "x-forwarded-for": browserClientIP(run, index),
      },
    });
    context.setDefaultTimeout(15000);
    const client = context.request;
    try {
      const email = `verification-${run}-${index}@example.com`,
        password = `Synthetic-${randomUUID()}!`;
      const signup = await client.post("/api/auth/sign-up/email", {
        data: {
          name: "Synthetic verification fixture",
          email,
          password,
          callbackURL: "/organizations",
        },
      });
      assert.equal(signup.status(), 200);
      const user = await adminDb.user.findUniqueOrThrow({ where: { email } });
      users.push(user.id);
      assert.equal(user.emailVerified, false);
      assert.equal(
        (
          await client.post("/api/auth/sign-in/email", {
            data: { email, password },
          })
        ).status(),
        403,
        "Unverified accounts must remain denied",
      );
      const inbox = await (
        await fetch("http://127.0.0.1:8025/api/v1/messages")
      ).json();
      const mail = inbox.messages.find((m: { To: { Address: string }[] }) =>
        m.To.some((t) => t.Address === email),
      );
      assert.ok(mail);
      const message = await (
        await fetch(`http://127.0.0.1:8025/api/v1/message/${mail.ID}`)
      ).json();
      const url = message.Text.match(/https?:\/\/[^\s]+/)[0];
      assert.equal(new URL(url).origin, new URL(base).origin);
      await verifyFixtureEmail(client, url, user.id, `target-${index}`);
      assert.equal(
        (
          await client.post("/api/auth/sign-in/email", {
            data: { email, password },
          })
        ).status(),
        200,
      );
      console.log(
        `PASS verification fixture ${index}: unverified denied; real Mailpit link persisted verification; sign-in succeeds`,
      );
    } finally {
      await context.close();
    }
  }
} catch (error) {
  console.error(
    "Targeted verification failed (" +
      (error instanceof Error ? error.name : "unknown") +
      "); credential details suppressed.",
  );
  process.exitCode = 1;
} finally {
  try {
    assertStable();
  } catch {
    console.error("Targeted verification checkout changed during execution.");
    process.exitCode = 1;
  }
  await browser.close();
  await adminDb.user.deleteMany({ where: { id: { in: users } } });
  await adminDb.$disconnect();
}
