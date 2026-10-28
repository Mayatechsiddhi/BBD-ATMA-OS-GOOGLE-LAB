"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z, ZodError } from "zod";
import { requireSession } from "@/lib/session";
import { logger } from "@/lib/logger";
import { AccessError } from "@/modules/organizations/policy";
import * as clinic from "@/modules/clinic/service";
import { ClinicError } from "@/modules/clinic/workflow";
import { clinicDate, fromLocal } from "@/modules/clinic/time";
import type { AvailabilityState } from "@/modules/clinic/availability-state";

export async function findClinicSlots(
  _previous: AvailabilityState,
  data: FormData,
): Promise<AvailabilityState> {
  const { user } = await requireSession();
  try {
    return {
      slots: await clinic.suggestAppointments(
        user.id,
        id(data, "organizationId"),
        id(data, "leadId"),
        {
          doctorId: id(data, "doctorId"),
          startsAt: fromLocal(text(data, "windowStart")),
          endsAt: fromLocal(text(data, "windowEnd")),
          duration: text(data, "duration"),
        },
      ),
    };
  } catch (e) {
    if (e instanceof AccessError) return { error: "Access denied." };
    if (e instanceof ClinicError) return { error: e.message };
    // Do not echo selectors, patient input or database errors.
    return { error: "Choose a valid doctor, window and duration." };
  }
}
const text = (data: FormData, name: string) => z.string().parse(data.get(name));
const id = (data: FormData, name: string) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,100}$/)
    .parse(data.get(name));
function leadData(data: FormData) {
  return {
    name: text(data, "name"),
    phone: text(data, "phone"),
    email: text(data, "email"),
    source: text(data, "source"),
  };
}
function appointmentData(data: FormData) {
  return {
    resource: text(data, "resource"),
    startsAt: fromLocal(text(data, "startsAt")),
    endsAt: fromLocal(text(data, "endsAt")),
  };
}
function followUpData(data: FormData) {
  return { title: text(data, "title"), dueAt: fromLocal(text(data, "dueAt")) };
}
async function finish(
  org: string,
  destination: string,
  work: () => Promise<unknown>,
  day?: () => string,
) {
  let error = "";
  try {
    await work();
  } catch (e) {
    if (e instanceof AccessError)
      error = "You do not have permission to perform this action.";
    else if (e instanceof ClinicError) error = e.message;
    else if (e instanceof ZodError) error = "Please check the form values.";
    else {
      error = "The clinic request could not be completed.";
      logger.error({
        event: "clinic.action.failed",
        errorType: e instanceof Error ? e.name : "unknown",
      });
    }
  }
  const base = `/organizations/${encodeURIComponent(org)}`;
  revalidatePath(base, "layout");
  const query = new URLSearchParams();
  if (day?.()) query.set("day", day());
  if (error) query.set("error", error);
  redirect(`${base}/clinic${destination}${query.size ? `?${query}` : ""}`);
}
export async function addClinicLead(org: string, data: FormData) {
  const { user } = await requireSession();
  let created = "";
  // Creation redirects to the new lead only after persistence succeeded.
  let failure = "";
  try {
    created = (await clinic.createLead(user.id, org, leadData(data))).id;
  } catch (e) {
    if (e instanceof AccessError)
      failure = "You do not have permission to perform this action.";
    else if (e instanceof ZodError) failure = "Please check the form values.";
    else {
      failure = "The clinic request could not be completed.";
      logger.error({ event: "clinic.lead.create.failed" });
    }
  }
  revalidatePath(`/organizations/${encodeURIComponent(org)}`, "layout");
  redirect(
    `/organizations/${encodeURIComponent(org)}/clinic/leads${created ? `/${created}` : `?error=${encodeURIComponent(failure)}`}`,
  );
}
export async function editClinicLead(org: string, data: FormData) {
  const { user } = await requireSession();
  await finish(org, "/leads", () =>
    clinic.updateLead(user.id, org, id(data, "leadId"), leadData(data)),
  );
}
export async function changeClinicLeadStatus(org: string, data: FormData) {
  const { user } = await requireSession();
  await finish(org, "/leads", () =>
    clinic.transitionLead(
      user.id,
      org,
      id(data, "leadId"),
      text(data, "status"),
    ),
  );
}
export async function bookClinicAppointment(org: string, data: FormData) {
  const { user } = await requireSession();
  let day = "";
  await finish(
    org,
    "/appointments",
    async () => {
      day = clinicDate(
        (
          await clinic.bookAppointment(
            user.id,
            org,
            id(data, "leadId"),
            appointmentData(data),
          )
        ).startsAt,
      );
    },
    () => day,
  );
}
export async function moveClinicAppointment(org: string, data: FormData) {
  const { user } = await requireSession();
  let day = "";
  await finish(
    org,
    "/appointments",
    async () => {
      day = clinicDate(
        (
          await clinic.rescheduleAppointment(
            user.id,
            org,
            id(data, "appointmentId"),
            appointmentData(data),
          )
        ).startsAt,
      );
    },
    () => day,
  );
}
export async function changeClinicAppointmentStatus(
  org: string,
  data: FormData,
) {
  const { user } = await requireSession();
  let day = "";
  await finish(
    org,
    "/appointments",
    async () => {
      day = clinicDate(
        (
          await clinic.transitionAppointment(
            user.id,
            org,
            id(data, "appointmentId"),
            text(data, "status"),
          )
        ).startsAt,
      );
    },
    () => day,
  );
}
export async function addClinicFollowUp(org: string, data: FormData) {
  const { user } = await requireSession();
  await finish(org, "/follow-ups", () =>
    clinic.createFollowUp(user.id, org, id(data, "leadId"), followUpData(data)),
  );
}
export async function editClinicFollowUp(org: string, data: FormData) {
  const { user } = await requireSession();
  await finish(org, "/follow-ups", () =>
    clinic.updateFollowUp(
      user.id,
      org,
      id(data, "followUpId"),
      followUpData(data),
    ),
  );
}
export async function changeClinicFollowUpStatus(org: string, data: FormData) {
  const { user } = await requireSession();
  await finish(org, "/follow-ups", () =>
    clinic.transitionFollowUp(
      user.id,
      org,
      id(data, "followUpId"),
      text(data, "status"),
    ),
  );
}
