import { z } from "zod";
import { clinicDate, dayRange } from "./time";
import type { Interval } from "./availability";

const minute = z.number().int().min(0).max(1440).multipleOf(15);
export const workingDay = z
  .object({
    weekday: z.number().int().min(0).max(6),
    start: minute,
    end: minute,
    breakStart: minute.nullable(),
    breakEnd: minute.nullable(),
  })
  .refine(
    (d) =>
      d.end > d.start &&
      ((d.breakStart === null && d.breakEnd === null) ||
        (d.breakStart !== null &&
          d.breakEnd !== null &&
          d.breakStart >= d.start &&
          d.breakEnd <= d.end &&
          d.breakEnd > d.breakStart)),
    "Invalid hours or break",
  );
export const leaveDay = z.string().refine((day) => {
  try {
    dayRange(day);
    return true;
  } catch {
    return false;
  }
}, "Invalid leave date");
export const weeklyInput = z.object({
  duration: z.coerce.number().int().min(15).max(480).multipleOf(15),
  weekly: z
    .array(workingDay)
    .max(7)
    .refine(
      (days) => new Set(days.map((d) => d.weekday)).size === days.length,
      "Duplicate weekday",
    ),
});
export const scheduleInput = weeklyInput.extend({
  leave: z
    .array(leaveDay)
    .max(366)
    .refine((days) => new Set(days).size === days.length),
});
export type DoctorSchedule = z.infer<typeof scheduleInput>;
export function readSchedule(input: unknown): DoctorSchedule | null {
  return input === null ? null : scheduleInput.parse(input);
}
export function scheduleAllows(
  schedule: DoctorSchedule,
  slot: Interval,
  enforceDuration = true,
) {
  const day = clinicDate(slot.startsAt);
  if (
    clinicDate(new Date(slot.endsAt.getTime() - 1)) !== day ||
    slot.endsAt <= slot.startsAt ||
    schedule.leave.includes(day)
  )
    return false;
  const dayStart = dayRange(day).start.getTime();
  const start = (slot.startsAt.getTime() - dayStart) / 60000;
  const end = (slot.endsAt.getTime() - dayStart) / 60000;
  const weekday = new Date(`${day}T12:00:00+05:30`).getUTCDay();
  const rule = schedule.weekly.find((d) => d.weekday === weekday);
  return (
    !!rule &&
    start >= rule.start &&
    end <= rule.end &&
    (!enforceDuration ||
      (end - start === schedule.duration && start % 15 === 0)) &&
    (rule.breakStart === null ||
      end <= rule.breakStart ||
      start >= rule.breakEnd!)
  );
}
