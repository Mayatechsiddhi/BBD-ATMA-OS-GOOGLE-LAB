"use server";
import { z, ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { AccessError } from "@/modules/organizations/policy";
import { ClinicError } from "@/modules/clinic/workflow";
import { changeDoctorSchedule } from "@/modules/clinic/schedule-service";
import { logger } from "@/lib/logger";
import { scheduleMinutes } from "@/modules/clinic/schedule";
const text = (data: FormData, key: string) =>
  z.string().max(100).parse(data.get(key));
async function submit(
  org: string,
  data: FormData,
  kind: "weekly" | "leave" | "removeLeave",
) {
  const { user } = await requireSession();
  let error = "";
  try {
    const input =
      kind === "weekly"
        ? {
            duration: text(data, "duration"),
            weekly: Array.from({ length: 7 }, (_, weekday) => weekday)
              .filter((d) => data.get(`open${d}`) === "on")
              .map((weekday) => ({
                weekday,
                start: scheduleMinutes(text(data, `start${weekday}`)),
                end: scheduleMinutes(text(data, `end${weekday}`), true),
                breakStart: data.get(`breakStart${weekday}`)
                  ? scheduleMinutes(text(data, `breakStart${weekday}`))
                  : null,
                breakEnd: data.get(`breakEnd${weekday}`)
                  ? scheduleMinutes(text(data, `breakEnd${weekday}`), true)
                  : null,
              })),
          }
        : text(data, "day");
    await changeDoctorSchedule(
      user.id,
      org,
      z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,100}$/)
        .parse(data.get("doctorId")),
      text(data, "version"),
      kind,
      input,
    );
  } catch (e) {
    if (e instanceof AccessError) error = "Access denied.";
    else if (e instanceof ClinicError) error = e.message;
    else if (e instanceof ZodError)
      error =
        "Check hours, breaks and appointment duration (15-minute increments).";
    else {
      error = "The schedule could not be saved.";
      logger.error({
        event: "clinic.schedule.failed",
        errorType: e instanceof Error ? e.name : "unknown",
      });
    }
  }
  const base = `/organizations/${encodeURIComponent(org)}`;
  revalidatePath(base, "layout");
  redirect(
    `${base}/clinic/schedules?${error ? `error=${encodeURIComponent(error)}` : "saved=1"}`,
  );
}
export async function saveDoctorHours(org: string, data: FormData) {
  return submit(org, data, "weekly");
}
export async function addDoctorLeave(org: string, data: FormData) {
  return submit(org, data, "leave");
}
export async function removeDoctorLeave(org: string, data: FormData) {
  return submit(org, data, "removeLeave");
}
