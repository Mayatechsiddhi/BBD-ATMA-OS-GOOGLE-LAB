import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
const base = process.env.BETTER_AUTH_URL!;
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw new Error("HTTP smoke tests are restricted to local development.");
const id = randomUUID(),
  email = `http-${id}@example.com`,
  password = `Test-${randomUUID()}!`;
const source = `2001:db8:${id.slice(0, 4)}:${id.slice(4, 8)}::1`;
let cookie = "";
let userId: string | undefined;
const orgIds: string[] = [];
async function request(path: string, init: RequestInit = {}) {
  return fetch(base + path, {
    ...init,
    redirect: "manual",
    headers: {
      Origin: base,
      "x-forwarded-for": source,
      ...(cookie ? { Cookie: cookie } : {}),
      ...init.headers,
    },
  });
}
async function auth(path: string, body: unknown) {
  return request(`/api/auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const decode = (value: string) =>
  value
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
function actionForm(html: string, field: string) {
  const form = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
    .map((m) => m[0])
    .find((s) => s.includes(`name="${field}"`));
  assert.ok(form, "Expected server-rendered administration form");
  const data = new FormData();
  for (const match of form.matchAll(/<input\b[^>]*>/g)) {
    const name = match[0].match(/name="([^"]+)"/)?.[1];
    const value = match[0].match(/value="([^"]*)"/)?.[1];
    if (name?.startsWith("$ACTION_"))
      data.append(decode(name), decode(value ?? ""));
  }
  assert.ok([...data.keys()].length, "Expected Next.js action metadata");
  return data;
}
try {
  const health = await request("/api/health");
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, "ok");
  const anonymous = await request("/organizations");
  assert.equal(anonymous.status, 307);
  assert.equal(anonymous.headers.get("location"), "/sign-in");
  const signup = await auth("sign-up/email", {
    name: "HTTP test owner",
    callbackURL: "/organizations",
    email,
    password,
  });
  assert.equal(signup.status, 200);
  userId = (await db.user.findUniqueOrThrow({ where: { email } })).id;
  const inbox = await (
    await fetch("http://127.0.0.1:8025/api/v1/messages")
  ).json();
  const mail = inbox.messages.find((m: { To: { Address: string }[] }) =>
    m.To.some((to) => to.Address === email),
  );
  assert.ok(mail);
  const message = await (
    await fetch(`http://127.0.0.1:8025/api/v1/message/${mail.ID}`)
  ).json();
  const url = message.Text.match(/https?:\/\/[^\s]+/)[0];
  const verified = await fetch(url, { redirect: "manual" });
  assert.ok([200, 302].includes(verified.status));
  const login = await auth("sign-in/email", { email, password });
  assert.equal(login.status, 200);
  cookie = login.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
  assert.ok(cookie.includes("session_token"));
  const organizations = await request("/organizations");
  assert.equal(organizations.status, 200);
  const html = await organizations.text();
  assert.ok(html.includes("Your organizations"));
  assert.equal(organizations.headers.get("x-frame-options"), "DENY");
  assert.ok(
    organizations.headers
      .get("content-security-policy")
      ?.includes("frame-ancestors 'none'"),
  );
  const create = actionForm(html, "slug");
  create.set("name", "HTTP persisted workspace");
  create.set("slug", `http-${id}`);
  const created = await request("/organizations", {
    method: "POST",
    body: create,
  });
  assert.equal(created.status, 303);
  const location = created.headers.get("location")!;
  assert.match(location, /\/organizations\/[a-z0-9]+/);
  const orgId = location.split("/").at(-1)!;
  orgIds.push(orgId);
  assert.equal(
    (await db.organization.findUniqueOrThrow({ where: { id: orgId } })).name,
    "HTTP persisted workspace",
  );
  const dashboard = await request(location);
  assert.equal(dashboard.status, 200);
  assert.ok((await dashboard.text()).includes("Recent activity"));
  const settings = await request(location + "/settings");
  const settingsHtml = await settings.text();
  const update = actionForm(settingsHtml, "name");
  update.set("name", "HTTP updated workspace");
  const updated = await request(location + "/settings", {
    method: "POST",
    body: update,
  });
  assert.equal(updated.status, 200);
  assert.equal(
    (await db.organization.findUniqueOrThrow({ where: { id: orgId } })).name,
    "HTTP updated workspace",
  );

  const crmPath = location + "/crm";
  const clientForm = actionForm(await (await request(crmPath)).text(), "email");
  clientForm.set("name", "HTTP client workflow");
  clientForm.set("email", email);
  clientForm.set("company", "HTTP client company");
  assert.equal(
    (await request(crmPath, { method: "POST", body: clientForm })).status,
    200,
  );
  const contact = await db.contact.findUniqueOrThrow({
    where: { organizationId_email: { organizationId: orgId, email } },
  });
  assert.equal(contact.status, "LEAD");
  for (const status of ["QUALIFIED", "CUSTOMER"] as const) {
    const transition = actionForm(
      await (await request(crmPath)).text(),
      "status",
    );
    transition.set("status", status);
    assert.equal(
      (await request(crmPath, { method: "POST", body: transition })).status,
      200,
    );
    assert.equal(
      (await db.contact.findUniqueOrThrow({ where: { id: contact.id } }))
        .status,
      status,
    );
  }
  assert.equal(
    await db.auditEvent.count({
      where: { organizationId: orgId, subjectId: contact.id },
    }),
    3,
  );
  for (const path of ["/members", "/modules"]) {
    const page = await request(location + path);
    assert.equal(page.status, 200);
  }
  assert.equal((await request("/organizations/foreign-tenant-id")).status, 404);
  const csrf = actionForm(settingsHtml, "name");
  csrf.set("name", "Attack");
  const rejected = await request(location + "/settings", {
    method: "POST",
    body: csrf,
    headers: { Origin: "https://attacker.example" },
  });
  assert.ok(rejected.status >= 400);
  assert.equal(
    (await db.organization.findUniqueOrThrow({ where: { id: orgId } })).name,
    "HTTP updated workspace",
  );
  await auth("sign-out", {});
  cookie = "";
  assert.equal((await request(location)).status, 307);
  console.log(
    "HTTP smoke passed: database health, real signup/email verification/sign-in, protected redirects, organization creation and settings through Server Actions, dashboard, members, module boundaries, tenant denial, CSRF rejection, persisted lead-to-customer CRM workflow and audit trail, and sign-out.",
  );
} finally {
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
  if (userId) await db.user.delete({ where: { id: userId } });
  await db.$disconnect();
}
