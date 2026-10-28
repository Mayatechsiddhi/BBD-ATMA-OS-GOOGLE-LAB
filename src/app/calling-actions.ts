"use server";
import { z, ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { logger } from "@/lib/logger";
import { AccessError } from "@/modules/organizations/policy";
import { ClinicError } from "@/modules/clinic/workflow";
import * as calling from "@/modules/calling/service";
const text = (data: FormData, key: string) =>
  z.string().max(254).parse(data.get(key));
const id = (data: FormData, key: string) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,100}$/)
    .parse(data.get(key));
async function finish(org: string, work: (actor: string) => Promise<unknown>) {
  const { user } = await requireSession();
  let error = "";
  try {
    await work(user.id);
  } catch (e) {
    if (e instanceof AccessError) error = "Access denied.";
    else if (e instanceof ClinicError) error = e.message;
    else if (e instanceof ZodError) error = "Check the form values.";
    else {
      error =
        "The queue request could not be completed. Check for a duplicate resource or patient registration.";
      logger.error({
        event: "calling.action.failed",
        errorType: e instanceof Error ? e.name : "unknown",
      });
    }
  }
  const base = `/organizations/${encodeURIComponent(org)}`;
  revalidatePath(base, "layout");
  redirect(
    `${base}/clinic/reception${error ? `?error=${encodeURIComponent(error)}` : ""}`,
  );
}
export async function registerClinicPatient(org: string, data: FormData) {
  return finish(org, (actor) =>
    calling.registerPatient(actor, org, {
      name: text(data, "name"),
      phone: text(data, "phone"),
      email: text(data, "email"),
      source: text(data, "source"),
    }),
  );
}
export async function registerClinicLead(org: string, data: FormData) {
  return finish(org, (actor) =>
    calling.registerLead(actor, org, id(data, "leadId")),
  );
}
export async function addClinicDoctor(org: string, data: FormData) {
  return finish(org, (actor) =>
    calling.createDoctor(actor, org, {
      name: text(data, "name"),
      room: text(data, "room"),
      resource: text(data, "resource"),
    }),
  );
}
export async function editClinicDoctor(org: string, data: FormData) {
  return finish(org, (actor) =>
    calling.updateDoctor(actor, org, id(data, "doctorId"), {
      name: text(data, "name"),
      room: text(data, "room"),
    }),
  );
}
export async function issueClinicToken(org: string, data: FormData) {
  return finish(org, (actor) =>
    calling.issueToken(actor, org, {
      doctorId: id(data, "doctorId"),
      ...(data.get("appointmentId")
        ? { appointmentId: id(data, "appointmentId") }
        : { patientId: id(data, "patientId") }),
    }),
  );
}
export async function changeClinicToken(org: string, data: FormData) {
  return finish(org, (actor) =>
    calling.actOnToken(actor, org, id(data, "tokenId"), text(data, "action")),
  );
}
