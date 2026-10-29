import type { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { withOrganization, audit } from "@/modules/organizations/access";
import { AccessError } from "@/modules/organizations/policy";
import { activeAppointments, ClinicError } from "./workflow";
import {
  readSchedule,
  scheduleInput,
  weeklyInput,
  leaveDay,
  scheduleAllows,
} from "./schedule";
import type { Interval } from "./availability";

export async function doctorSchedules(actor: string, org: string) {
  return withOrganization(actor, org, "read", async (tx) => {
    const doctors = await tx.doctor.findMany({
      where: { organizationId: org },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        room: true,
        schedule: true,
        scheduleVersion: true,
      },
      take: 50,
    });
    return doctors.map((d) => ({ ...d, schedule: readSchedule(d.schedule) }));
  });
}
export async function enforceDoctorSchedule(
  tx: Prisma.TransactionClient,
  org: string,
  resource: string,
  slot: Interval,
) {
  const doctor = await tx.doctor.findUnique({
    where: { organizationId_resource: { organizationId: org, resource } },
    select: { schedule: true },
  });
  if (!doctor) return; // Existing generic room/resources remain supported.
  const policy = readSchedule(doctor.schedule);
  if (policy && !scheduleAllows(policy, slot))
    throw new ClinicError(
      "Choose the doctor's appointment duration within working hours, outside breaks and leave.",
    );
}
export async function changeDoctorSchedule(
  actor: string,
  org: string,
  doctorId: string,
  version: unknown,
  kind: "weekly" | "leave" | "removeLeave",
  input: unknown,
) {
  const expected = z.coerce
    .number()
    .int()
    .min(0)
    .max(2147483646)
    .parse(version);
  return withOrganization(actor, org, "crm:write", async (tx) => {
    const doctor = await tx.doctor.findUnique({
      where: { organizationId_id: { organizationId: org, id: doctorId } },
    });
    if (!doctor) throw new AccessError();
    if (doctor.scheduleVersion !== expected)
      throw new ClinicError("The schedule changed. Reload and try again.");
    const previous = readSchedule(doctor.schedule);
    let next;
    if (kind === "weekly")
      next = scheduleInput.parse({
        ...weeklyInput.parse(input),
        leave: previous?.leave ?? [],
      });
    else {
      if (!previous)
        throw new ClinicError("Save working hours before adding leave.");
      const day = leaveDay.parse(input);
      if (kind === "leave" && previous.leave.includes(day))
        throw new ClinicError("Leave already exists for that day.");
      if (kind === "removeLeave" && !previous.leave.includes(day))
        throw new ClinicError("Leave no longer exists. Reload the schedule.");
      next = scheduleInput.parse({
        ...previous,
        leave:
          kind === "leave"
            ? [...previous.leave, day].sort()
            : previous.leave.filter((d) => d !== day),
      });
    }
    // Preserve bookings; don't silently cancel/move them when staff edit hours.
    // Existing durations are grandfathered; new/rescheduled appointments use the new duration.
    const appointments = await tx.appointment.findMany({
      where: {
        organizationId: org,
        resource: doctor.resource,
        status: { in: activeAppointments },
        endsAt: { gt: new Date() },
      },
      select: { startsAt: true, endsAt: true },
    });
    if (appointments.some((a) => !scheduleAllows(next, a, false)))
      throw new ClinicError(
        "This change conflicts with an active appointment. Reschedule or cancel it first.",
      );
    const updated = await tx.doctor.update({
      where: { organizationId_id: { organizationId: org, id: doctorId } },
      data: {
        schedule: next,
        scheduleVersion: { increment: 1 },
        revision: { increment: 1 },
      },
    });
    await audit(tx, org, actor, `clinic.schedule.${kind}`, doctorId);
    return updated;
  });
}
