import { describe, it, expect } from "vitest";
import {
  scheduleInput,
  scheduleAllows,
  readSchedule,
} from "../../src/modules/clinic/schedule";
const policy = scheduleInput.parse({
  duration: 30,
  weekly: [
    { weekday: 1, start: 540, end: 1020, breakStart: 720, breakEnd: 780 },
  ],
  leave: ["2030-01-14"],
});
const slot = (start: string, end: string) => ({
  startsAt: new Date(`2030-01-07T${start}:00+05:30`),
  endsAt: new Date(`2030-01-07T${end}:00+05:30`),
});
describe("doctor scheduling rules", () => {
  it("allows working hours with half-open break boundaries", () => {
    expect(scheduleAllows(policy, slot("09:00", "09:30"))).toBe(true);
    expect(scheduleAllows(policy, slot("11:30", "12:00"))).toBe(true);
    expect(scheduleAllows(policy, slot("13:00", "13:30"))).toBe(true);
  });
  it("rejects breaks and outside hours", () => {
    for (const [start, end] of [
      ["08:45", "09:15"],
      ["11:45", "12:15"],
      ["12:00", "12:30"],
      ["16:45", "17:15"],
    ])
      expect(scheduleAllows(policy, slot(start, end))).toBe(false);
  });
  it("enforces fixed duration and grid for new bookings", () => {
    expect(scheduleAllows(policy, slot("09:00", "10:00"))).toBe(false);
    expect(scheduleAllows(policy, slot("09:05", "09:35"))).toBe(false);
    expect(scheduleAllows(policy, slot("09:00", "10:00"), false)).toBe(true);
  });
  it("rejects closed days, leave and overnight appointments", () => {
    for (const day of ["2030-01-08", "2030-01-14"])
      expect(
        scheduleAllows(policy, {
          startsAt: new Date(`${day}T09:00:00+05:30`),
          endsAt: new Date(`${day}T09:30:00+05:30`),
        }),
      ).toBe(false);
    expect(
      scheduleAllows(policy, {
        ...slot("09:00", "09:30"),
        endsAt: new Date("2030-01-08T09:30:00+05:30"),
      }),
    ).toBe(false);
  });
  it("validates breaks, duplicates, dates and duration", () => {
    const rule = policy.weekly[0];
    for (const input of [
      { ...policy, duration: 17 },
      { ...policy, leave: ["2030-02-30"] },
      { ...policy, weekly: [rule, rule] },
      { ...policy, weekly: [{ ...rule, breakEnd: null }] },
      { ...policy, weekly: [{ ...rule, end: 500 }] },
      { ...policy, weekly: [{ ...rule, breakStart: 510 }] },
    ])
      expect(scheduleInput.safeParse(input).success).toBe(false);
  });
  it("fails closed on corrupt persisted configuration; only null is legacy", () => {
    expect(readSchedule(null)).toBeNull();
    expect(() => readSchedule({})).toThrow();
  });
});
