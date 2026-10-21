"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { ZodError } from "zod";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session";
import { logger } from "@/lib/logger";
import { AccessError } from "@/modules/organizations/policy";
import * as service from "@/modules/organizations/service";
import * as crm from "@/modules/crm/service";
import { memberRole } from "@/modules/organizations/validation";
function value(data: FormData, key: string) {
  const v = data.get(key);
  if (typeof v !== "string") throw new Error("Invalid form");
  return v;
}
async function perform(path: string, run: () => Promise<void>) {
  let error: string | undefined;
  try {
    await run();
  } catch (e) {
    if (e instanceof AccessError)
      error = "You do not have permission to perform this action.";
    else if (e instanceof ZodError) error = "Please check the form values.";
    else if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    )
      error = "This address is already in use in this workspace.";
    else if (
      e instanceof Error &&
      (e.message === "The organization must retain an owner." ||
        e.message === "Invalid client workflow transition.")
    )
      error = e.message;
    else {
      error = "The request could not be completed.";
      logger.error({
        event: "action.failed",
        errorType: e instanceof Error ? e.name : "unknown",
      });
    }
  }
  revalidatePath("/organizations", "layout");
  if (error) redirect(`${path}?error=${encodeURIComponent(error)}`);
}
export async function signOut() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/sign-in");
}
export async function createOrganization(data: FormData) {
  const { user } = await requireSession();
  let id = "";
  await perform("/organizations", async () => {
    id = (
      await service.createOrganization(user.id, {
        name: value(data, "name"),
        slug: value(data, "slug"),
      })
    ).id;
  });
  redirect(`/organizations/${id}`);
}
export async function updateOrganization(id: string, data: FormData) {
  const { user } = await requireSession();
  await perform(`/organizations/${id}/settings`, async () => {
    await service.updateOrganization(user.id, id, value(data, "name"));
  });
}
export async function inviteMember(
  _previous: { token?: string; error?: string },
  data: FormData,
): Promise<{ token?: string; error?: string }> {
  const { user } = await requireSession();
  try {
    const id = value(data, "organizationId");
    const token = await service.createInvitation(user.id, id, {
      email: value(data, "email"),
      role: value(data, "role"),
    });
    revalidatePath(`/organizations/${id}/members`);
    return { token };
  } catch (e) {
    if (e instanceof AccessError) return { error: "Access denied." };
    if (e instanceof ZodError)
      return { error: "Check the invitation email and role." };
    logger.error({ event: "invitation.create.failed" });
    return { error: "Unable to create invitation." };
  }
}
export async function changeMember(id: string, target: string, data: FormData) {
  const { user } = await requireSession();
  await perform(`/organizations/${id}/members`, async () => {
    await service.changeMember(
      user.id,
      id,
      target,
      memberRole.parse(value(data, "role")),
    );
  });
}
export async function removeMember(id: string, target: string) {
  const { user } = await requireSession();
  await perform(`/organizations/${id}/members`, async () => {
    await service.changeMember(user.id, id, target, null);
  });
}
export async function revokeInvitation(id: string, invitationId: string) {
  const { user } = await requireSession();
  await perform(`/organizations/${id}/members`, async () => {
    await service.revokeInvitation(user.id, id, invitationId);
  });
}
export async function acceptInvitation(data: FormData) {
  const { user } = await requireSession();
  let id = "";
  await perform("/invitations", async () => {
    id = await service.acceptInvitation(user.id, value(data, "token"));
  });
  redirect(`/organizations/${id}`);
}

export async function createContact(id: string, data: FormData) {
  const { user } = await requireSession();
  await perform(`/organizations/${id}/crm`, async () => {
    await crm.createContact(user.id, id, {
      name: value(data, "name"),
      email: value(data, "email"),
      company: value(data, "company"),
    });
  });
}
export async function transitionContact(
  id: string,
  contactId: string,
  data: FormData,
) {
  const { user } = await requireSession();
  await perform(`/organizations/${id}/crm`, async () => {
    await crm.transitionContact(user.id, id, contactId, value(data, "status"));
  });
}
