import { fixtureClientHeaders } from "./browser-fixture-client";
import { navigate } from "./browser-navigation";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { browserDiagnostics, browserSourceGuard } from "./browser-diagnostics";
import { verifyFixtureEmail } from "./browser-verification";
import { adminDb } from "./local-admin-db";
import { callingBrowser } from "./browser-calling";
import { clinicBrowser } from "./browser-clinic";
import { entitlementsBrowser } from "./browser-entitlements";
import { opportunitiesBrowser } from "./browser-opportunities";
import { browserClientIP, verifyAuthRateLimits } from "./browser-client-ip";
import { db } from "../src/lib/db";
import { createOrganization } from "../src/modules/organizations/service";

const base = process.env.BETTER_AUTH_URL!;
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw new Error("Browser fixtures are local-only");
const run = process.env.BROWSER_RUN_ID ?? randomUUID();
assert.match(run, /^[a-f0-9-]{36}$/);
const password = `Browser-${randomUUID()}!`;
const userIds: string[] = [],
  orgIds: string[] = [];
const focus = process.env.BROWSER_FOCUS ?? "all";
assert.ok(["all", "invitation", "calling"].includes(focus));
console.log(`Browser scenario selection: ${focus}`);
const assertStableSources = browserSourceGuard();
const cdp = process.env.BROWSER_CDP_URL;
if (cdp)
  assert.equal(
    cdp,
    "http://127.0.0.1:9223",
    "Only the isolated loopback fixture browser is supported",
  );
const browser = cdp
  ? await chromium.connectOverCDP(cdp)
  : await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
      headless: true,
    });
const contexts: BrowserContext[] = [];
const captures: (() => Promise<void>)[] = [];
const sensitive = [password];
const renderingErrors: string[] = [];
const serverLog = process.env.BROWSER_SERVER_LOG;
const mailpit = process.env.BROWSER_MAILPIT_URL ?? "http://127.0.0.1:8025";
const mailpitURL = new URL(mailpit);
assert.ok(
  ["localhost", "127.0.0.1"].includes(mailpitURL.hostname) &&
    mailpitURL.protocol === "http:" &&
    !mailpitURL.username &&
    !mailpitURL.password,
  "Local capture-only mail service required",
);
console.log(`Browser: ${browser.version()}`);
async function account(label: string) {
  const context = await browser.newContext({
    baseURL: base,
    extraHTTPHeaders: {
      ...fixtureClientHeaders(browserClientIP(run, contexts.length + 1)),
    },
  });
  context.on("page", (page) => {
    page.on("pageerror", (error) => renderingErrors.push(error.name));
    page.on("console", (message) => {
      if (message.type() === "error" && message.text().includes("enqueueModel"))
        renderingErrors.push("RSC decoder enqueueModel");
    });
  });
  context.setDefaultTimeout(15000);
  contexts.push(context);
  captures.push(
    await browserDiagnostics(context, process.env.BROWSER_ARTIFACT_DIR, label),
  );
  const email = `browser-${label}-${run}@example.com`;
  const signup = await context.request.post("/api/auth/sign-up/email", {
    headers: {
      Origin: base,
    },
    data: {
      name: `Browser ${label}`,
      email,
      password,
      callbackURL: "/organizations",
    },
  });
  assert.equal(signup.status(), 200, "Real auth signup must succeed");
  const user = await adminDb.user.findUniqueOrThrow({ where: { email } });
  userIds.push(user.id);
  const inbox = await (await fetch(`${mailpit}/api/v1/messages`)).json();
  const mail = inbox.messages.find((m: { To: { Address: string }[] }) =>
    m.To.some((t) => t.Address === email),
  );
  assert.ok(mail, "Verification must be delivered to local Mailpit");
  const message = await (
    await fetch(`${mailpit}/api/v1/message/${mail.ID}`)
  ).json();
  const verification = message.Text.match(/https?:\/\/[^\s]+/)[0];
  sensitive.push(verification);
  assert.equal(new URL(verification).origin, new URL(base).origin);
  await verifyFixtureEmail(context.request, verification, user.id, label);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  await navigate(page, "/sign-in", "invitations-1");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const signedIn = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === "/api/auth/sign-in/email",
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const signInStatus = (await signedIn).status();
  assert.equal(
    signInStatus,
    200,
    `Real UI sign-in must succeed for synthetic ${label} (HTTP ${signInStatus})`,
  );
  await page.waitForURL("**/organizations", { waitUntil: "commit" });
  assert.equal(
    new URL(page.url()).search,
    "",
    "Credentials must never enter navigation URLs",
  );
  return { context, page, email, userId: user.id };
}
async function submit(page: Page, email: string) {
  await page.getByLabel("Email address").fill(email);
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname.endsWith("/members"),
    { timeout: 15000 },
  );
  await page.getByRole("button", { name: "Create private invitation" }).click();
  const r = await response;
  assert.equal(r.status(), 200);
  // RSC development debug streams may remain open after the action has committed.
  // Verify the user's completion state with a deadline; native HTTP separately checks the full body.
  await page
    .getByRole("button", { name: "Create private invitation", exact: true })
    .waitFor({ state: "visible", timeout: 15000 });
  assert.equal(
    await page
      .getByRole("button", { name: "Create private invitation", exact: true })
      .isEnabled(),
    true,
  );
  return r;
}
try {
  const owner = await account("owner"),
    foreign = await account("foreign"),
    recipient = await account("recipient"),
    // Keep real authentication fixture setup together, before navigation/action
    // phases compile additional routes. All auth assertions/deadlines remain.
    displayAccount = await account("calling-display");
  await verifyAuthRateLimits(owner.context, base, run);
  const org = await createOrganization(owner.userId, {
    name: "Browser invitation A",
    slug: `browser-a-${run}`,
  });
  orgIds.push(org.id);
  const b = await createOrganization(foreign.userId, {
    name: "Browser invitation B",
    slug: `browser-b-${run}`,
  });
  orgIds.push(b.id);
  if (focus !== "calling") {
    const members = `/organizations/${org.id}/members`;
    await navigate(owner.page, members, "invitations-2", {
      waitUntil: "commit",
    });
    await owner.page.locator('form[data-hydrated="true"]').waitFor();
    const started = Date.now();
    const response = await submit(owner.page, recipient.email);
    await owner.page.getByLabel("Private invitation link").waitFor();
    const link = await owner.page
      .getByLabel("Private invitation link")
      .inputValue();
    const token = new URL(link).hash.slice("#token=".length);
    sensitive.push(token);
    assert.match(token, /^[a-f0-9]{64}$/);
    const invitation = await adminDb.invitation.findUniqueOrThrow({
      where: { tokenHash: createHash("sha256").update(token).digest("hex") },
    });
    assert.equal(invitation.organizationId, org.id);
    console.log(
      `PASS hydrated invitation POST and private link (${Date.now() - started}ms)`,
    );

    // Replay the actual browser request with another tenant's session; action IDs are not authorization.
    const captured = response.request();
    const headers = await captured.allHeaders();
    delete headers.cookie;
    delete headers.host;
    delete headers["content-length"];
    const count = await adminDb.invitation.count({
      where: { organizationId: org.id },
    });
    const denied = await foreign.context.request.post(captured.url(), {
      headers,
      data: captured.postDataBuffer()!,
      timeout: 15000,
    });
    assert.equal(denied.status(), 200);
    assert.ok((await denied.text()).includes("Access denied."));
    assert.equal(
      await adminDb.invitation.count({ where: { organizationId: org.id } }),
      count,
    );
    console.log(
      "PASS tenant B replay of tenant A invitation POST denied without persistence",
    );

    // Forge a real captured payload with correctly recomputed HTTP framing.
    const originalBody = captured.postDataBuffer()!.toString();
    const forgedBody = originalBody.replace(
      /(name="[^"]*role"\r\n\r\n)MEMBER(\r\n)/,
      "$1OWNER$2",
    );
    assert.notEqual(
      forgedBody,
      originalBody,
      "Expected role field in actual React transport",
    );
    console.log(
      "CHECK forged-role request with correctly framed captured payload",
    );
    const invalid = await owner.context.request.post(captured.url(), {
      headers,
      data: Buffer.from(forgedBody),
      timeout: 15000,
    });
    assert.equal(invalid.status(), 200);
    assert.ok(
      (await invalid.text()).includes("Check the invitation email and role."),
    );
    console.log(
      "PASS forged OWNER payload rejected without creating an invitation",
    );
    assert.equal(
      await adminDb.invitation.count({ where: { organizationId: org.id } }),
      count,
    );
    console.log("CHECK repeated submission from the same browser form");
    await submit(owner.page, `repeat-${run}@example.com`);
    await owner.page.waitForFunction((previous) => {
      const input = document.querySelector<HTMLInputElement>(
        'input[aria-label="Private invitation link"]',
      );
      return input && input.value !== previous;
    }, link);
    const repeatedLink = await owner.page
      .getByLabel("Private invitation link")
      .inputValue();
    assert.notEqual(repeatedLink, link);
    sensitive.push(new URL(repeatedLink).hash.slice("#token=".length));
    assert.equal(
      await adminDb.invitation.count({ where: { organizationId: org.id } }),
      count + 1,
    );
    console.log(
      "PASS forged OWNER role rejected; same form recovers and creates a fresh invitation",
    );

    await navigate(foreign.page, link, "invitations-3", {
      waitUntil: "commit",
    });
    await foreign.page.waitForFunction(() => location.hash === "");
    await foreign.page
      .getByRole("button", { name: "Accept invitation" })
      .click();
    await foreign.page.waitForURL("**/invitations?error=**", {
      waitUntil: "commit",
    });
    assert.equal(
      await adminDb.membership.count({
        where: { organizationId: org.id, userId: foreign.userId },
      }),
      0,
    );
    await navigate(recipient.page, link, "invitations-4", {
      waitUntil: "commit",
    });
    await recipient.page.waitForFunction(() => location.hash === "");
    await recipient.page
      .getByRole("button", { name: "Accept invitation" })
      .click();
    await recipient.page.waitForURL(`**/organizations/${org.id}`, {
      waitUntil: "commit",
    });
    assert.equal(
      (
        await adminDb.membership.findUniqueOrThrow({
          where: {
            organizationId_userId: {
              organizationId: org.id,
              userId: recipient.userId,
            },
          },
        })
      ).role,
      "MEMBER",
    );
    assert.ok(
      (
        await adminDb.invitation.findUniqueOrThrow({
          where: { id: invitation.id },
        })
      ).acceptedAt,
    );
    await navigate(recipient.page, link, "invitations-5", {
      waitUntil: "commit",
    });
    await recipient.page.waitForFunction(() => location.hash === "");
    await recipient.page
      .getByRole("button", { name: "Accept invitation" })
      .click();
    await recipient.page.waitForURL("**/invitations?error=**", {
      waitUntil: "commit",
    });
    assert.equal(
      await adminDb.auditEvent.count({
        where: { organizationId: org.id, action: "invitation.accepted" },
      }),
      1,
    );
    console.log(
      "PASS wrong recipient denied; matching recipient accepts; token replay denied; atomic membership/audit",
    );

    // A real HTML submission, without a custom approximation of React's form metadata.
    const nojs = await browser.newContext({
      baseURL: base,
      javaScriptEnabled: false,
      extraHTTPHeaders: fixtureClientHeaders(browserClientIP(run, 1)),
      storageState: await owner.context.storageState(),
    });
    contexts.push(nojs);
    captures.push(
      await browserDiagnostics(nojs, process.env.BROWSER_ARTIFACT_DIR, "nojs"),
    );
    const page = await nojs.newPage();
    page.setDefaultTimeout(15000);
    for (const path of [
      "/sign-in",
      "/sign-up",
      "/forgot-password",
      "/reset-password?token=fixture-only",
    ]) {
      await navigate(page, path, "invitations-6");
      const form = page.locator("form").first();
      assert.equal(await form.getAttribute("method"), "post");
      assert.equal(
        await form
          .locator("button[type=submit], button:not([type])")
          .isDisabled(),
        true,
      );
    }
    console.log(
      "PASS unhydrated authentication/recovery forms cannot submit credentials through GET",
    );
    await navigate(page, members, "invitations-7");
    await submit(page, `nojs-${run}@example.com`);
    await page.getByLabel("Private invitation link").waitFor();
    assert.equal(
      await adminDb.invitation.count({
        where: { organizationId: org.id, email: `nojs-${run}@example.com` },
      }),
      1,
    );
    console.log(
      "PASS native no-JavaScript invitation POST completes and persists exactly once",
    );
    sensitive.push(
      new URL(
        await page.getByLabel("Private invitation link").inputValue(),
      ).hash.slice("#token=".length),
    );
  }
  if (focus === "all") {
    sensitive.push(
      ...(await clinicBrowser({
        owner: owner.page,
        foreign: foreign.context,
        member: recipient.page,
        org: org.id,
        run,
      })),
    );
    sensitive.push(
      ...(await opportunitiesBrowser(
        owner.page,
        foreign.context,
        recipient.page,
        org.id,
        run,
      )),
    );
  }
  if (focus === "all")
    await entitlementsBrowser(
      owner.page,
      foreign.context,
      recipient.page,
      org.id,
    );
  if (focus !== "invitation") {
    sensitive.push(
      ...(await callingBrowser({
        owner: owner.page,
        foreign: foreign.context,
        screen: displayAccount.page,
        org: org.id,
        actor: owner.userId,
        screenUser: displayAccount.userId,
        run,
      })),
    );
  }
  if (serverLog) {
    const log = readFileSync(serverLog, "utf8");
    assert.ok(
      sensitive.every((secret) => !log.includes(secret)),
      "Fixture passwords and private tokens must not appear in server logs",
    );
    console.log(
      "PASS server log contains no fixture password, verification URL, invitation token or clinic search values",
    );
  } else {
    console.log(
      "NOT RUN server-log exclusion: set BROWSER_SERVER_LOG to the current local server log",
    );
  }
} catch (error) {
  // Playwright errors can contain request bodies, cookies, or token-bearing URLs.
  console.error(
    `Browser invitation validation failed (${error instanceof Error ? error.name : "unknown"}${error instanceof Error && error.message.startsWith("Invitation response did not finish") ? ": response-stream-timeout" : ""}); request details suppressed.`,
  );
  if (error instanceof Error) {
    if (error.name === "TimeoutError")
      console.error(
        "Browser timeout phase",
        JSON.stringify({
          clickCompleted: error.message.includes("click action done"),
          waitingForNavigation: error.message.includes(
            "waiting for scheduled navigations",
          ),
        }),
      );
    const scenarioLocation = error.stack?.match(
      /browser-(?:clinic|calling|invitations|slots|schedules|opportunities|entitlements)\.ts:\d+:\d+/,
    )?.[0];
    if (scenarioLocation)
      console.error(`Browser scenario location: ${scenarioLocation}`);
    const first = sensitive.reduce(
      (text, secret) => text.replaceAll(secret, "[REDACTED]"),
      error.message.split("\n")[0],
    );
    console.error(
      first
        .replace(/https?:\/\/\S+/g, "[URL]")
        .replace(/\b[a-f0-9]{32,}\b/g, "[TOKEN]")
        .replace(/\S+@\S+/g, "[EMAIL]")
        .slice(0, 180),
    );
  }
  process.exitCode = 1;
} finally {
  // A browser/transport teardown error must not prevent fixture cleanup.
  try {
    try {
      for (const capture of captures) {
        try {
          await capture();
        } catch {
          console.error("Browser artifact capture failed; details suppressed.");
          process.exitCode = 1;
        }
      }
      try {
        assertStableSources();
        assert.equal(
          renderingErrors.length,
          0,
          "Browser rendering/decoder errors must not be ignored",
        );
      } catch (error) {
        console.error(
          error instanceof Error
            ? error.message
            : "Browser validation guard failed.",
        );
        process.exitCode = 1;
      }
    } finally {
      await browser.close();
    }
  } finally {
    try {
      await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
    } finally {
      try {
        await adminDb.user.deleteMany({ where: { id: { in: userIds } } });
      } finally {
        await Promise.all([db.$disconnect(), adminDb.$disconnect()]);
      }
    }
  }
}
