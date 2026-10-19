import { createHash, randomBytes } from "node:crypto";
import { type Role } from "@/generated/prisma/client";
import { z } from "zod";
import { db } from "../../lib/db";
import { AccessError } from "./policy";
import { withOrganization, audit } from "./access";
import {
  organizationInput,
  inviteInput,
  memberRole,
  tokenInput,
} from "./validation";
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function createOrganization(userId: string, input: unknown) {
  const data = organizationInput.parse(input);
  return db.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: { ...data, memberships: { create: { userId, role: "OWNER" } } },
    });
    await audit(tx, org.id, userId, "organization.created");
    return org;
  });
}
export async function listOrganizations(userId: string) {
  return db.organization.findMany({
    where: { memberships: { some: { userId } } },
    orderBy: { createdAt: "asc" },
  });
}
export async function getOrganization(userId: string, organizationId: string) {
  return withOrganization(userId, organizationId, "read", async (tx, role) => ({
    organization: await tx.organization.findUniqueOrThrow({
      where: { id: organizationId },
    }),
    role,
    members: await tx.membership.findMany({
      where: { organizationId },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
    invitations:
      role === "MEMBER"
        ? []
        : await tx.invitation.findMany({
            where: {
              organizationId,
              acceptedAt: null,
              expiresAt: { gt: new Date() },
            },
            select: { id: true, email: true, role: true, expiresAt: true },
          }),
    events: await tx.auditEvent.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  }));
}
export async function updateOrganization(
  userId: string,
  organizationId: string,
  input: unknown,
) {
  const name = z.string().trim().min(2).max(100).parse(input);
  return withOrganization(userId, organizationId, "settings", async (tx) => {
    const org = await tx.organization.update({
      where: { id: organizationId },
      data: { name },
    });
    await audit(tx, organizationId, userId, "organization.updated");
    return org;
  });
}
export async function createInvitation(
  userId: string,
  organizationId: string,
  input: unknown,
) {
  const data = inviteInput.parse(input);
  const token = randomBytes(32).toString("hex");
  await withOrganization(userId, organizationId, "invite", async (tx) => {
    const invitation = await tx.invitation.create({
      data: {
        ...data,
        organizationId,
        tokenHash: hash(token),
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      },
    });
    await audit(
      tx,
      organizationId,
      userId,
      "invitation.created",
      invitation.id,
    );
  });
  return token;
}
export async function acceptInvitation(userId: string, rawToken: string) {
  const token = tokenInput.parse(rawToken);
  return db.$transaction(async (tx) => {
    const invitation = await tx.invitation.findUnique({
      where: { tokenHash: hash(token) },
    });
    if (!invitation) throw new AccessError();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${invitation.organizationId}, 0))`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.emailVerified || user.email.toLowerCase() !== invitation.email)
      throw new AccessError();
    const consumed = await tx.invitation.updateMany({
      where: {
        id: invitation.id,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { acceptedAt: new Date() },
    });
    if (consumed.count !== 1) throw new AccessError();
    // Existing members retain their role; an invitation cannot promote an existing account.
    await tx.membership.upsert({
      where: {
        organizationId_userId: {
          organizationId: invitation.organizationId,
          userId,
        },
      },
      create: {
        organizationId: invitation.organizationId,
        userId,
        role: invitation.role,
      },
      update: {},
    });
    await audit(
      tx,
      invitation.organizationId,
      userId,
      "invitation.accepted",
      invitation.id,
    );
    return invitation.organizationId;
  });
}
export async function changeMember(
  userId: string,
  organizationId: string,
  targetUserId: string,
  role: Role | null,
) {
  if (role !== null) memberRole.parse(role);
  return withOrganization(userId, organizationId, "members", async (tx) => {
    const target = await tx.membership.findUniqueOrThrow({
      where: {
        organizationId_userId: { organizationId, userId: targetUserId },
      },
    });
    if (
      target.role === "OWNER" &&
      role !== "OWNER" &&
      (await tx.membership.count({
        where: { organizationId, role: "OWNER" },
      })) <= 1
    )
      throw new Error("The organization must retain an owner.");
    if (role === null) await tx.membership.delete({ where: { id: target.id } });
    else
      await tx.membership.update({ where: { id: target.id }, data: { role } });
    await audit(
      tx,
      organizationId,
      userId,
      role === null ? "member.removed" : "member.role_changed",
      targetUserId,
    );
  });
}
export async function revokeInvitation(
  userId: string,
  organizationId: string,
  id: string,
) {
  return withOrganization(userId, organizationId, "invite", async (tx) => {
    const result = await tx.invitation.deleteMany({
      where: { id, organizationId, acceptedAt: null },
    });
    if (result.count !== 1) throw new AccessError();
    await audit(tx, organizationId, userId, "invitation.revoked", id);
  });
}
