"use server";
import { z, ZodError } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { logger } from "@/lib/logger";
import { AccessError } from "@/modules/organizations/policy";
import {
  createOpportunity,
  transitionOpportunity,
  OpportunityError,
} from "@/modules/crm/opportunities";
const text = (data: FormData, key: string) => z.string().parse(data.get(key));
async function finish(org: string, work: (actor: string) => Promise<unknown>) {
  const { user } = await requireSession();
  let error = "";
  try {
    await work(user.id);
  } catch (e) {
    if (e instanceof AccessError) error = "Access denied.";
    else if (e instanceof OpportunityError) error = e.message;
    else if (e instanceof ZodError)
      error = "Check the contact, title, INR value and stage.";
    else {
      error = "The opportunity could not be saved.";
      logger.error({
        event: "crm.opportunity.failed",
        errorType: e instanceof Error ? e.name : "unknown",
      });
    }
  }
  const base = `/organizations/${encodeURIComponent(org)}/crm`;
  revalidatePath(base, "layout");
  revalidatePath(`${base}/opportunities`);
  redirect(
    `${base}/opportunities${error ? `?error=${encodeURIComponent(error)}` : ""}`,
  );
}
export async function addOpportunity(org: string, data: FormData) {
  return finish(org, (actor) =>
    createOpportunity(actor, org, {
      contactId: text(data, "contactId"),
      title: text(data, "title"),
      amount: text(data, "amount"),
      requestKey: text(data, "requestKey"),
    }),
  );
}
export async function moveOpportunity(org: string, data: FormData) {
  return finish(org, (actor) =>
    transitionOpportunity(
      actor,
      org,
      z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,100}$/)
        .parse(data.get("opportunityId")),
      text(data, "version"),
      text(data, "stage"),
    ),
  );
}
