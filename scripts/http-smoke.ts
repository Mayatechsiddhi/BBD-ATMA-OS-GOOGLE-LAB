import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { adminDb as db } from "./local-admin-db";
import { localInput, clinicDate } from "../src/modules/clinic/time";
const base = process.env.BETTER_AUTH_URL!;
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw new Error("HTTP smoke tests are restricted to local development.");
const id = randomUUID(),
  email = `http-${id}@example.com`,
  password = `Test-${randomUUID()}!`;
const source = `2001:db8:${id.slice(0, 4)}:${id.slice(4, 8)}::1`;
let cookie = "";
const userIds: string[] = [];
const orgIds: string[] = [];
async function request(path: string, init: RequestInit = {}) {
  return fetch(base + path, {
    // Dev-mode GETs can compile a route on first navigation. Mutations keep the
    // 20-second bound, including the invitation/clinic POST regressions.
    signal: AbortSignal.timeout(init.method === "POST" ? 20000 : 60000),
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
    .find((s) =>
      field.startsWith("text:")
        ? s.includes(field.slice(5))
        : s.includes(`name="${field}"`),
    );
  assert.ok(form, "Expected server-rendered administration form");
  const data = new FormData();
  for (const match of form.matchAll(/<input\b[^>]*>/g)) {
    const name = match[0].match(/name="([^"]+)"/)?.[1];
    const value = match[0].match(/value="([^"]*)"/)?.[1];
    if (
      name &&
      (name.startsWith("$ACTION_") || match[0].includes('type="hidden"'))
    )
      data.append(decode(name), decode(value ?? ""));
  }
  assert.ok([...data.keys()].length, "Expected Next.js action metadata");
  return data;
}
async function registerAccount(address: string, label: string) {
  const signup = await auth("sign-up/email", {
    name: label,
    callbackURL: "/organizations",
    email: address,
    password,
  });
  assert.equal(signup.status, 200);
  const createdId = (
    await db.user.findUniqueOrThrow({ where: { email: address } })
  ).id;
  userIds.push(createdId);
  const inbox = await (
    await fetch("http://127.0.0.1:8025/api/v1/messages")
  ).json();
  const mail = inbox.messages.find((m: { To: { Address: string }[] }) =>
    m.To.some((to) => to.Address === address),
  );
  assert.ok(mail);
  const message = await (
    await fetch(`http://127.0.0.1:8025/api/v1/message/${mail.ID}`)
  ).json();
  const url = message.Text.match(/https?:\/\/[^\s]+/)[0];
  const verified = await fetch(url, { redirect: "manual" });
  assert.ok([200, 302].includes(verified.status));
  const login = await auth("sign-in/email", { email: address, password });
  assert.equal(login.status, 200);
  cookie = login.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
  assert.ok(cookie.includes("session_token"));

  return createdId;
}
try {
  const health = await request("/api/health");
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, "ok");
  const anonymous = await request("/organizations");
  assert.equal(anonymous.status, 307);
  assert.equal(anonymous.headers.get("location"), "/sign-in");
  await registerAccount(email, "HTTP test owner");
  const organizations = await request("/organizations");
  assert.equal(organizations.status, 200);
  const html = await organizations.text();
  assert.ok(html.includes("Your organizations"));
  assert.equal(organizations.headers.get("x-frame-options"), "DENY");
  assert.equal(organizations.headers.get("referrer-policy"), "same-origin");
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

  const clinicBase = location + "/clinic";
  const clinicLeadForm = actionForm(
    await (await request(clinicBase + "/leads")).text(),
    "phone",
  );
  clinicLeadForm.set("name", `Synthetic HTTP clinic ${id}`);
  clinicLeadForm.set("phone", "+12025550101");
  clinicLeadForm.set("email", "");
  clinicLeadForm.set("source", "REFERRAL");
  const clinicCreated = await request(clinicBase + "/leads", {
    method: "POST",
    body: clinicLeadForm,
  });
  assert.equal(clinicCreated.status, 303);
  const clinicLeadPath = clinicCreated.headers.get("location")!;
  const clinicLeadId = clinicLeadPath.split("/").at(-1)!;
  const clinicDetail = await (await request(clinicLeadPath)).text();
  const booking = actionForm(clinicDetail, "startsAt");
  const clinicStart = new Date(Date.now() + 4 * 86400000),
    clinicEnd = new Date(clinicStart.getTime() + 1800000);
  booking.set("resource", "Synthetic HTTP clinician");
  booking.set("startsAt", localInput(clinicStart));
  booking.set("endsAt", localInput(clinicEnd));
  const booked = await request(clinicLeadPath, {
    method: "POST",
    body: booking,
  });
  assert.equal(booked.status, 303);
  assert.equal(
    booked.headers.get("location"),
    clinicBase + "/appointments?day=" + clinicDate(clinicStart),
  );
  const clinicAppointment = await db.appointment.findFirstOrThrow({
    where: { organizationId: orgId, leadId: clinicLeadId },
  });
  const clinicFollow = actionForm(clinicDetail, "title");
  clinicFollow.set("title", `Synthetic HTTP follow-up ${id}`);
  clinicFollow.set("dueAt", localInput(clinicStart));
  assert.equal(
    (await request(clinicLeadPath, { method: "POST", body: clinicFollow }))
      .status,
    303,
  );
  const followPage = await (await request(clinicBase + "/follow-ups")).text();
  const completeFollow = actionForm(
    followPage,
    "text:>Complete follow-up</button>",
  );
  completeFollow.set("status", "DONE");
  assert.equal(
    (
      await request(clinicBase + "/follow-ups", {
        method: "POST",
        body: completeFollow,
      })
    ).status,
    303,
  );
  assert.equal(
    (
      await db.followUp.findFirstOrThrow({
        where: { organizationId: orgId, leadId: clinicLeadId },
      })
    ).status,
    "DONE",
  );
  assert.ok(
    (await (await request(clinicBase)).text()).includes("Clinic dashboard"),
  );
  assert.equal(clinicAppointment.status, "SCHEDULED");

  const cookieA = cookie;
  cookie = "";
  await registerAccount(`http-b-${id}@example.com`, "HTTP tenant B owner");
  const cookieB = cookie;
  const bCreate = actionForm(
    await (await request("/organizations")).text(),
    "slug",
  );
  bCreate.set("name", `Private B ${id}`);
  bCreate.set("slug", `http-b-${id}`);
  const bCreated = await request("/organizations", {
    method: "POST",
    body: bCreate,
  });
  assert.equal(bCreated.status, 303);
  const bLocation = bCreated.headers.get("location")!;
  const bOrg = bLocation.split("/").at(-1)!;
  orgIds.push(bOrg);
  const bSettings = actionForm(
    await (await request(bLocation + "/settings")).text(),
    "name",
  );
  const bLead = actionForm(
    await (await request(bLocation + "/crm")).text(),
    "email",
  );
  bLead.set("name", `Private client B ${id}`);
  bLead.set("email", `b-client-${id}@example.com`);
  bLead.set("company", "Private B");
  assert.equal(
    (await request(bLocation + "/crm", { method: "POST", body: bLead })).status,
    200,
  );
  const bTransition = actionForm(
    await (await request(bLocation + "/crm")).text(),
    "status",
  );
  const bInvite = actionForm(
    await (await request(bLocation + "/members")).text(),
    "email",
  );
  bInvite.set("email", `recipient-b-${id}@example.com`);
  bInvite.set("role", "MEMBER");
  const issued = await request(bLocation + "/members", {
    method: "POST",
    body: bInvite,
  });
  assert.equal(issued.status, 200);
  assert.ok((await issued.text()).includes("Private invitation link"));
  const bMembers = await (await request(bLocation + "/members")).text();
  const bRemove = actionForm(bMembers, "text:>Remove</button>");
  const bRevoke = actionForm(bMembers, "text:>Revoke</button>");
  for (const path of [
    clinicBase,
    clinicBase + "/leads",
    clinicLeadPath,
    clinicBase + "/appointments",
    clinicBase + "/follow-ups",
  ]) {
    const denied = await request(path);
    assert.equal(denied.status, 404);
    assert.ok(!(await denied.text()).includes(`Synthetic HTTP clinic ${id}`));
  }
  const deniedClinicBooking = await request(clinicLeadPath, {
    method: "POST",
    body: booking,
  });
  assert.equal(deniedClinicBooking.status, 303);
  assert.ok(
    deniedClinicBooking.headers.get("location")?.includes("permission"),
  );
  assert.equal(
    await db.appointment.count({
      where: { organizationId: orgId, leadId: clinicLeadId },
    }),
    1,
  );
  cookie = cookieA;
  const deniedInvite = await request(bLocation + "/members", {
    method: "POST",
    body: bInvite,
  });
  // A native POST re-renders B's page after the denied action, so the page boundary returns 404.
  assert.equal(deniedInvite.status, 404);
  assert.ok(!(await deniedInvite.text()).includes(`Private B ${id}`));
  for (const suffix of ["", "/settings", "/members", "/crm", "/modules"]) {
    const foreign = await request(bLocation + suffix);
    assert.equal(foreign.status, 404);
    const body = await foreign.text();
    assert.ok(!body.includes(`Private B ${id}`));
    assert.ok(!body.includes(`Private client B ${id}`));
  }
  bSettings.set("name", "Foreign settings attack");
  bTransition.set("status", "QUALIFIED");
  for (const [path, body] of [
    ["/settings", bSettings],
    ["/crm", bTransition],
    ["/members", bRemove],
    ["/members", bRevoke],
  ] as const) {
    const attacked = await request(bLocation + path, { method: "POST", body });
    assert.equal(attacked.status, 303);
    assert.ok(attacked.headers.get("location")?.includes("permission"));
  }
  assert.equal(
    (await db.organization.findUniqueOrThrow({ where: { id: bOrg } })).name,
    `Private B ${id}`,
  );
  assert.equal(
    (
      await db.contact.findUniqueOrThrow({
        where: {
          organizationId_email: {
            organizationId: bOrg,
            email: `b-client-${id}@example.com`,
          },
        },
      })
    ).status,
    "LEAD",
  );
  assert.equal(
    await db.membership.count({
      where: { organizationId: bOrg, role: "OWNER" },
    }),
    1,
  );
  assert.equal(
    await db.invitation.count({ where: { organizationId: bOrg } }),
    1,
  );
  assert.equal(
    await db.auditEvent.count({
      where: {
        organizationId: bOrg,
        action: {
          in: [
            "organization.updated",
            "crm.contact.qualified",
            "member.removed",
            "invitation.revoked",
          ],
        },
      },
    }),
    0,
  );
  cookie = cookieB;
  assert.equal((await request(bLocation + "/crm")).status, 200);
  cookie = cookieA;
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
    "HTTP smoke passed: database health, real signup/email verification/sign-in, protected redirects, organization creation and settings through Server Actions, dashboard, members, module boundaries, tenant denial, CSRF rejection, persisted lead-to-customer CRM workflow and audit trail, and sign-out; real tenant B pages and captured Server Actions reject tenant A cookies; clinic lead creation, IST appointment booking, follow-up completion, dashboard and foreign-session clinic page/action denial.",
  );
} finally {
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
}
