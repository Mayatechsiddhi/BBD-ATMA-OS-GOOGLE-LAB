import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { db } from "../../src/lib/db";
import { auth } from "../../src/lib/auth";
import * as service from "../../src/modules/organizations/service";
import * as crm from "../../src/modules/crm/service";
import { AccessError } from "../../src/modules/organizations/policy";
const suffix = randomUUID();
const password = `Strong-Test-${randomUUID()}!`;
const userIds: string[] = [];
const orgIds: string[] = [];
let owner: string,
  other: string,
  member: string,
  admin: string,
  organizationId: string,
  otherOrg: string,
  cookie: string;
const base = process.env.BETTER_AUTH_URL!;
async function request(
  path: string,
  body?: unknown,
  session?: string,
  ip = "2001:db8:" + suffix.slice(0, 4) + ":1::1",
) {
  const headers: Record<string, string> = {
    Origin: base,
    "x-forwarded-for": ip,
  };
  if (body) headers["Content-Type"] = "application/json";
  if (session) headers.Cookie = session;
  return auth.handler(
    new Request(`${base}/api/auth/${path}`, {
      method: body ? "POST" : "GET",
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
}
async function account(label: string) {
  const email = `${label}-${suffix}@example.com`;
  const ip = `2001:db8:${randomUUID().slice(0, 4)}:${randomUUID().slice(0, 4)}::1`;
  const call = (path: string, body?: unknown) =>
    request(path, body, undefined, ip);
  const signup = await call("sign-up/email", { name: label, email, password });
  expect(signup.status).toBe(200);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  userIds.push(user.id);
  expect(user.emailVerified).toBe(false);
  const blocked = await call("sign-in/email", { email, password });
  expect(blocked.status).toBe(403);
  const inbox = await (
    await fetch("http://127.0.0.1:8025/api/v1/messages")
  ).json();
  const mail = inbox.messages.find((m: { To: { Address: string }[] }) =>
    m.To.some((to) => to.Address === email),
  );
  expect(mail).toBeTruthy();
  const message = await (
    await fetch(`http://127.0.0.1:8025/api/v1/message/${mail.ID}`)
  ).json();
  const link = message.Text.match(/https?:\/\/[^\s]+/)[0];
  const token = new URL(link).searchParams.get("token");
  const verified = await call(
    `verify-email?token=${encodeURIComponent(token!)}`,
  );
  expect([200, 302]).toContain(verified.status);
  const login = await call("sign-in/email", { email, password });
  expect(login.status).toBe(200);
  const sessionCookie = login.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
  expect(sessionCookie).toContain("session_token");
  return { id: user.id, email, cookie: sessionCookie };
}
beforeAll(async () => {
  if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
    throw new Error("Dedicated test DB required");
  const a = await account("owner");
  owner = a.id;
  cookie = a.cookie;
  other = (await account("outsider")).id;
  member = (await account("member")).id;
  admin = (await account("admin")).id;
  const org = await service.createOrganization(owner, {
    name: "Foundation test",
    slug: `test-${suffix}`,
  });
  organizationId = org.id;
  orgIds.push(org.id);
  const second = await service.createOrganization(other, {
    name: "Second tenant",
    slug: `other-${suffix}`,
  });
  otherOrg = second.id;
  orgIds.push(second.id);
  await db.membership.createMany({
    data: [
      { organizationId, userId: member, role: "MEMBER" },
      { organizationId, userId: admin, role: "ADMIN" },
    ],
  });
}, 60000);
afterAll(async () => {
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
});
describe("real authentication and persisted tenant access", () => {
  it("persists password hashes and verifies database-backed sessions", async () => {
    const account = await db.account.findFirstOrThrow({
      where: { userId: owner },
    });
    expect(account.password).not.toBe(password);
    expect(account.password?.length).toBeGreaterThan(50);
    const session = await request("get-session", undefined, cookie);
    expect(session.status).toBe(200);
    expect((await session.json()).user.id).toBe(owner);
    expect(
      await db.session.count({ where: { userId: owner } }),
    ).toBeGreaterThan(0);
  });
  it("rejects wrong passwords and forged session cookies", async () => {
    const user = await db.user.findUniqueOrThrow({ where: { id: owner } });
    expect(
      (
        await request("sign-in/email", {
          email: user.email,
          password: "wrong-password-here",
        })
      ).status,
    ).toBe(401);
    expect(
      await (
        await request(
          "get-session",
          undefined,
          "better-auth.session_token=forged",
        )
      ).json(),
    ).toBeNull();
  });
  it("lists only memberships belonging to the authenticated user", async () => {
    expect((await service.listOrganizations(owner)).map((o) => o.id)).toEqual([
      organizationId,
    ]);
    expect((await service.listOrganizations(other)).map((o) => o.id)).toEqual([
      otherOrg,
    ]);
  });
  it("denies foreign tenant reads, settings, invitations and membership mutations", async () => {
    await expect(
      service.getOrganization(other, organizationId),
    ).rejects.toBeInstanceOf(AccessError);
    await expect(
      service.updateOrganization(other, organizationId, "Attack"),
    ).rejects.toBeInstanceOf(AccessError);
    await expect(
      service.createInvitation(other, organizationId, {
        email: "x@example.com",
        role: "ADMIN",
      }),
    ).rejects.toBeInstanceOf(AccessError);
    await expect(
      service.changeMember(other, organizationId, owner, "MEMBER"),
    ).rejects.toBeInstanceOf(AccessError);
  });
  it("enforces member read-only and administrator restrictions", async () => {
    expect(
      (await service.getOrganization(member, organizationId)).members.length,
    ).toBe(3);
    await expect(
      service.updateOrganization(member, organizationId, "Attack"),
    ).rejects.toBeInstanceOf(AccessError);
    await expect(
      service.createInvitation(member, organizationId, {
        email: "x@example.com",
        role: "MEMBER",
      }),
    ).rejects.toBeInstanceOf(AccessError);
    await expect(
      service.changeMember(admin, organizationId, member, "OWNER"),
    ).rejects.toBeInstanceOf(AccessError);
    await service.updateOrganization(
      admin,
      organizationId,
      "Updated by administrator",
    );
    expect(
      (await service.getOrganization(owner, organizationId)).organization.name,
    ).toBe("Updated by administrator");
  });
  it("preserves the last owner and logs successful mutations atomically", async () => {
    await expect(
      service.changeMember(owner, organizationId, owner, null),
    ).rejects.toThrow("retain an owner");
    await expect(
      service.changeMember(owner, organizationId, owner, "MEMBER"),
    ).rejects.toThrow("retain an owner");
    expect(
      await db.auditEvent.count({
        where: { organizationId, action: "organization.updated" },
      }),
    ).toBe(1);
    expect(
      await db.auditEvent.count({
        where: { organizationId, action: "member.removed" },
      }),
    ).toBe(0);
  });

  it("persists a real lead-to-customer workflow and its audit trail", async () => {
    const contact = await crm.createContact(owner, organizationId, {
      name: "Client relationship",
      email: `client-${suffix}@example.com`,
      company: "Client company",
    });
    expect(contact.status).toBe("LEAD");
    expect(
      (
        await crm.transitionContact(
          admin,
          organizationId,
          contact.id,
          "QUALIFIED",
        )
      ).status,
    ).toBe("QUALIFIED");
    expect(
      (
        await crm.transitionContact(
          owner,
          organizationId,
          contact.id,
          "CUSTOMER",
        )
      ).status,
    ).toBe("CUSTOMER");
    const events = await db.auditEvent.findMany({
      where: { organizationId, subjectId: contact.id },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.action)).toEqual([
      "crm.contact.created",
      "crm.contact.qualified",
      "crm.contact.customer",
    ]);
    expect(
      (
        await db.contact.findUniqueOrThrow({
          where: { organizationId_id: { organizationId, id: contact.id } },
        })
      ).status,
    ).toBe("CUSTOMER");
    expect(
      (
        await crm.transitionContact(
          admin,
          organizationId,
          contact.id,
          "ARCHIVED",
        )
      ).status,
    ).toBe("ARCHIVED");
  });
  it("isolates CRM lists, lookups, writes, tenant keys and permissions", async () => {
    const email = `shared-${suffix}@example.com`;
    const local = await crm.createContact(owner, organizationId, {
      name: "Local client",
      email,
    });
    const foreign = await crm.createContact(other, otherOrg, {
      name: "Foreign client",
      email,
    });
    expect(
      (await crm.listContacts(member, organizationId)).some(
        (c) => c.id === local.id,
      ),
    ).toBe(true);
    expect(
      (await crm.listContacts(owner, organizationId)).some(
        (c) => c.id === foreign.id,
      ),
    ).toBe(false);
    await expect(
      crm.listContacts(other, organizationId),
    ).rejects.toBeInstanceOf(AccessError);
    await expect(
      crm.createContact(member, organizationId, {
        name: "Blocked",
        email: "blocked@example.com",
      }),
    ).rejects.toBeInstanceOf(AccessError);
    await expect(
      crm.createContact(owner, otherOrg, {
        name: "Blocked",
        email: "blocked@example.com",
      }),
    ).rejects.toBeInstanceOf(AccessError);
    await expect(
      crm.transitionContact(owner, organizationId, foreign.id, "QUALIFIED"),
    ).rejects.toBeInstanceOf(AccessError);
    await expect(
      crm.transitionContact(other, organizationId, local.id, "QUALIFIED"),
    ).rejects.toBeInstanceOf(AccessError);
    await expect(
      crm.transitionContact(member, organizationId, local.id, "QUALIFIED"),
    ).rejects.toBeInstanceOf(AccessError);
    await expect(
      crm.createContact(owner, organizationId, { name: "Duplicate", email }),
    ).rejects.toMatchObject({ code: "P2002" });
    expect(
      (await db.contact.findUniqueOrThrow({ where: { id: foreign.id } }))
        .status,
    ).toBe("LEAD");
  });
  it("rejects invalid and duplicate concurrent workflow transitions without false audit events", async () => {
    const contact = await crm.createContact(owner, organizationId, {
      name: "Concurrent client",
      email: `concurrent-${suffix}@example.com`,
    });
    await expect(
      crm.transitionContact(owner, organizationId, contact.id, "CUSTOMER"),
    ).rejects.toThrow("Invalid client workflow transition");
    expect(
      await db.auditEvent.count({
        where: {
          organizationId,
          subjectId: contact.id,
          action: "crm.contact.customer",
        },
      }),
    ).toBe(0);
    const results = await Promise.allSettled([
      crm.transitionContact(owner, organizationId, contact.id, "QUALIFIED"),
      crm.transitionContact(admin, organizationId, contact.id, "QUALIFIED"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await db.auditEvent.count({
        where: {
          organizationId,
          subjectId: contact.id,
          action: "crm.contact.qualified",
        },
      }),
    ).toBe(1);
  });
  it("uses hashed, email-bound, single-use invitations and records acceptance", async () => {
    const user = await db.user.findUniqueOrThrow({ where: { id: other } });
    const token = await service.createInvitation(admin, organizationId, {
      email: user.email,
      role: "MEMBER",
    });
    expect(
      await db.invitation.findFirst({ where: { tokenHash: token } }),
    ).toBeNull();
    await expect(
      service.acceptInvitation(member, token),
    ).rejects.toBeInstanceOf(AccessError);
    const results = await Promise.allSettled([
      service.acceptInvitation(other, token),
      service.acceptInvitation(other, token),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await db.membership.count({ where: { organizationId, userId: other } }),
    ).toBe(1);
    await expect(service.acceptInvitation(other, token)).rejects.toBeInstanceOf(
      AccessError,
    );
  });
  it("rejects expired and revoked invitations and scopes revocation", async () => {
    const token = await service.createInvitation(owner, organizationId, {
      email: (await db.user.findUniqueOrThrow({ where: { id: other } })).email,
      role: "MEMBER",
    });
    const invitation = await db.invitation.findFirstOrThrow({
      where: {
        organizationId,
        email: (await db.user.findUniqueOrThrow({ where: { id: other } }))
          .email,
        acceptedAt: null,
      },
    });
    await db.invitation.update({
      where: { id: invitation.id },
      data: { expiresAt: new Date(0) },
    });
    await expect(service.acceptInvitation(other, token)).rejects.toBeInstanceOf(
      AccessError,
    );
    await expect(
      service.revokeInvitation(owner, otherOrg, invitation.id),
    ).rejects.toBeInstanceOf(AccessError);
    await service.revokeInvitation(owner, organizationId, invitation.id);
    await expect(service.acceptInvitation(other, token)).rejects.toBeInstanceOf(
      AccessError,
    );
  });

  it("rejects invitation acceptance by an unverified matching email", async () => {
    const email = `unverified-${suffix}@example.com`;
    expect(
      (
        await request(
          "sign-up/email",
          { name: "Unverified recipient", email, password },
          undefined,
          `2001:db8:${randomUUID().slice(0, 4)}:2::1`,
        )
      ).status,
    ).toBe(200);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    userIds.push(user.id);
    const token = await service.createInvitation(owner, organizationId, {
      email,
      role: "MEMBER",
    });
    await expect(
      service.acceptInvitation(user.id, token),
    ).rejects.toBeInstanceOf(AccessError);
    expect(
      await db.membership.count({ where: { organizationId, userId: user.id } }),
    ).toBe(0);
  });
  it("rejects a freshly revoked invitation for its verified recipient", async () => {
    const user = await db.user.findUniqueOrThrow({ where: { id: other } });
    const token = await service.createInvitation(owner, organizationId, {
      email: user.email,
      role: "MEMBER",
    });
    const invitation = await db.invitation.findFirstOrThrow({
      where: { organizationId, email: user.email, acceptedAt: null },
      orderBy: { createdAt: "desc" },
    });
    await service.revokeInvitation(owner, organizationId, invitation.id);
    await expect(service.acceptInvitation(other, token)).rejects.toBeInstanceOf(
      AccessError,
    );
  });
  it("removes access immediately after membership revocation", async () => {
    await service.changeMember(owner, organizationId, other, null);
    await expect(
      service.getOrganization(other, organizationId),
    ).rejects.toBeInstanceOf(AccessError);
  });
  it("serializes concurrent last-owner demotions", async () => {
    await service.changeMember(owner, organizationId, admin, "OWNER");
    const results = await Promise.allSettled([
      service.changeMember(owner, organizationId, owner, "ADMIN"),
      service.changeMember(admin, organizationId, admin, "ADMIN"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await db.membership.count({ where: { organizationId, role: "OWNER" } }),
    ).toBe(1);
  });

  it("resets passwords using delivered single-use tokens and revokes existing sessions", async () => {
    const recovery = await account("recovery");
    const reset = await request("request-password-reset", {
      email: recovery.email,
      redirectTo: "/reset-password",
    });
    expect(reset.status).toBe(200);
    const inbox = await (
      await fetch("http://127.0.0.1:8025/api/v1/messages")
    ).json();
    const mail = inbox.messages.find(
      (m: { Subject: string; To: { Address: string }[] }) =>
        m.Subject === "Reset your password" &&
        m.To.some((to) => to.Address === recovery.email),
    );
    expect(mail).toBeTruthy();
    const message = await (
      await fetch(`http://127.0.0.1:8025/api/v1/message/${mail.ID}`)
    ).json();
    const link = message.Text.match(/https?:\/\/[^\s]+/)[0];
    const token = new URL(link).pathname.split("/").at(-1)!;
    const newPassword = `New-${randomUUID()}!`;
    expect(
      (await request("reset-password", { token, newPassword })).status,
    ).toBe(200);
    expect(
      await (await request("get-session", undefined, recovery.cookie)).json(),
    ).toBeNull();
    expect(
      (await request("reset-password", { token, newPassword })).status,
    ).toBe(400);
    const ip = `2001:db8:${randomUUID().slice(0, 4)}:1::1`;
    expect(
      (
        await request(
          "sign-in/email",
          { email: recovery.email, password: newPassword },
          undefined,
          ip,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          "sign-in/email",
          { email: recovery.email, password },
          undefined,
          ip,
        )
      ).status,
    ).toBe(401);
  });
  it("rejects cross-origin auth mutations", async () => {
    const response = await auth.handler(
      new Request(`${base}/api/auth/sign-out`, {
        method: "POST",
        headers: {
          Origin: "https://attacker.example",
          Cookie: cookie,
          "Content-Type": "application/json",
        },
        body: "{}",
      }),
    );
    expect(response.status).toBe(403);
  });

  it("enforces persisted rate limits on repeated authentication failures", async () => {
    const ip = `2001:db8:${randomUUID().slice(0, 4)}:5::1`;
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++)
      statuses.push(
        (
          await request(
            "sign-in/email",
            { email: `missing-${suffix}@example.com`, password },
            undefined,
            ip,
          )
        ).status,
      );
    expect(statuses[0]).toBe(401);
    expect(statuses).toContain(429);
    expect(await db.rateLimit.count()).toBeGreaterThan(0);
  });
  it("invalidates sessions on sign-out", async () => {
    expect((await request("sign-out", {}, cookie)).status).toBe(200);
    expect(
      await (await request("get-session", undefined, cookie)).json(),
    ).toBeNull();
  });
});
