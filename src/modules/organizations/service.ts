import { createHash, randomBytes } from "node:crypto";
import { type Role } from "@/generated/prisma/client";
import { z } from "zod";
import {
  withActor,
  setOrganizationContext,
  bootstrapOrganization,
} from "@/lib/tenant-context";
import { AccessError } from "./policy";
import { withOrganization, audit } from "./access";
import {
  organizationInput,
  inviteInput,
  memberRole,
  tokenInput,
} from "./validation";
import { initialModuleIds, type ModuleId } from "@/modules/registry";
import { assertModuleAccess } from "@/modules/entitlements/access";
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function createOrganization(userId: string, input: unknown) {
  const data = organizationInput.parse(input);
  return withActor(userId, async (tx) => {
    const org = await bootstrapOrganization(
      tx,
      randomBytes(16).toString("hex"),
      data.name,
      data.slug,
    );
    await setOrganizationContext(tx, org.id);
    await tx.organizationModule.createMany({
      data: initialModuleIds.map((moduleId) => ({
        organizationId: org.id,
        moduleId,
        enabled: true,
      })),
    });
    await audit(tx, org.id, userId, "organization.modules_initialized");
    return org;
  });
}
export async function listOrganizations(userId: string) {
  return withActor(userId, (tx) =>
    tx.organization.findMany({
      where: { memberships: { some: { userId } } },
      include: { memberships: { where: { userId }, select: { role: true } } },
      orderBy: { createdAt: "asc" },
    }),
  );
}
export async function getOrganization(
  userId: string,
  organizationId: string,
  moduleId?: ModuleId,
) {
  return withOrganization(userId, organizationId, "read", async (tx, role) => {
    if (moduleId) await assertModuleAccess(tx, organizationId, moduleId);
    return {
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
    };
  });
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
  return withActor(
    userId,
    async (tx) => {
      const invitation = await tx.invitation.findUnique({
        where: { tokenHash: hash(token) },
      });
      if (!invitation) throw new AccessError();
      await setOrganizationContext(tx, invitation.organizationId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${invitation.organizationId}, 0))`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (!user.emailVerified || user.email.toLowerCase() !== invitation.email)
        throw new AccessError();
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
      const consumed = await tx.invitation.updateMany({
        where: {
          id: invitation.id,
          acceptedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { acceptedAt: new Date() },
      });
      if (consumed.count !== 1) throw new AccessError();
      await audit(
        tx,
        invitation.organizationId,
        userId,
        "invitation.accepted",
        invitation.id,
      );
      return invitation.organizationId;
    },
    "",
    hash(token),
  );
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
    await audit(
      tx,
      organizationId,
      userId,
      role === null ? "member.removed" : "member.role_changed",
      targetUserId,
    );
    if (role === null) await tx.membership.delete({ where: { id: target.id } });
    else
      await tx.membership.update({ where: { id: target.id }, data: { role } });
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
