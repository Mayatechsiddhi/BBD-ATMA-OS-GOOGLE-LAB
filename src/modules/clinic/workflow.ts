import type {
  AppointmentStatus,
  ClinicLeadStatus,
} from "@/generated/prisma/enums";
export class ClinicError extends Error {}
export const leadTransitions: Record<
  ClinicLeadStatus,
  readonly ClinicLeadStatus[]
> = {
  NEW: ["CONTACTED", "QUALIFIED", "LOST"],
  CONTACTED: ["QUALIFIED", "CONVERTED", "LOST"],
  QUALIFIED: ["CONVERTED", "LOST"],
  CONVERTED: [],
  LOST: [],
};
export const appointmentTransitions: Record<
  AppointmentStatus,
  readonly AppointmentStatus[]
> = {
  SCHEDULED: ["CONFIRMED", "CHECKED_IN", "CANCELLED", "NO_SHOW"],
  CONFIRMED: ["CHECKED_IN", "CANCELLED", "NO_SHOW"],
  CHECKED_IN: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};
export const activeAppointments: AppointmentStatus[] = [
  "SCHEDULED",
  "CONFIRMED",
  "CHECKED_IN",
];
export function checkAppointmentTransition(
  from: AppointmentStatus,
  to: AppointmentStatus,
  startsAt: Date,
  now = new Date(),
) {
  if (!appointmentTransitions[from].includes(to))
    throw new ClinicError("That appointment status change is not allowed.");
  if (["CHECKED_IN", "COMPLETED", "NO_SHOW"].includes(to) && startsAt > now)
    throw new ClinicError(
      "Attendance can be recorded only after the appointment starts.",
    );
}
