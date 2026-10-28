import { z } from "zod";
import { clinicDate } from "./time";

export const availabilityInput = z
  .object({
    doctorId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
    startsAt: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
    endsAt: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
    duration: z.coerce.number().int().min(15).max(480).multipleOf(15),
  })
  .refine(
    (v) =>
      v.endsAt > v.startsAt &&
      v.endsAt.getTime() - v.startsAt.getTime() <= 8 * 3600000 &&
      clinicDate(v.startsAt) === clinicDate(new Date(v.endsAt.getTime() - 1)),
    "Choose a window within one clinic day and eight hours",
  );

export type Interval = { startsAt: Date; endsAt: Date };

// Advisory only: booking rechecks current state under the organization lock.
export function freeSlots(
  window: Interval,
  duration: number,
  busy: Interval[],
  now: Date,
): Interval[] {
  const step = 15 * 60000;
  const slots: Interval[] = [];
  // IST's offset is a multiple of the grid, so UTC rounding preserves IST quarters.
  let start = Math.ceil(Math.max(+window.startsAt, +now + 1) / step) * step;
  for (; start + duration * 60000 <= +window.endsAt; start += step) {
    const candidate = {
      startsAt: new Date(start),
      endsAt: new Date(start + duration * 60000),
    };
    if (
      !busy.some(
        (b) => b.startsAt < candidate.endsAt && b.endsAt > candidate.startsAt,
      )
    )
      slots.push(candidate);
    if (slots.length === 5) break;
  }
  return slots;
}
