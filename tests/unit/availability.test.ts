import { describe, expect, it } from "vitest";
import {
  availabilityInput,
  freeSlots,
} from "../../src/modules/clinic/availability";
const date = (hour: string) => new Date(`2030-01-01T${hour}:00+05:30`);
const interval = (start: string, end: string) => ({
  startsAt: date(start),
  endsAt: date(end),
});
describe("bounded clinic slot suggestions", () => {
  it("returns at most five deterministic IST quarter-hour slots", () => {
    const slots = freeSlots(interval("09:01", "12:00"), 30, [], date("08:00"));
    expect(slots).toHaveLength(5);
    expect(slots[0]).toEqual(interval("09:15", "09:45"));
  });
  it("uses half-open boundaries and handles nested busy intervals", () => {
    expect(
      freeSlots(
        interval("09:00", "11:00"),
        30,
        [interval("09:30", "10:00"), interval("09:35", "09:45")],
        date("08:00"),
      ),
    ).toEqual([
      interval("09:00", "09:30"),
      interval("10:00", "10:30"),
      interval("10:15", "10:45"),
      interval("10:30", "11:00"),
    ]);
  });
  it("never offers elapsed starts or a partial duration", () => {
    expect(
      freeSlots(interval("09:00", "10:00"), 30, [], date("09:15")),
    ).toEqual([interval("09:30", "10:00")]);
    expect(
      freeSlots(interval("09:00", "09:15"), 30, [], date("08:00")),
    ).toEqual([]);
  });
  it("returns empty for fully occupied windows", () => {
    expect(
      freeSlots(
        interval("09:00", "10:00"),
        30,
        [interval("08:00", "12:00")],
        date("08:00"),
      ),
    ).toEqual([]);
  });
  const valid = {
    doctorId: "doctor",
    startsAt: date("09:00").toISOString(),
    endsAt: date("10:00").toISOString(),
    duration: 30,
  };
  it("rejects invalid doctor and duration", () => {
    for (const change of [
      { doctorId: "" },
      { duration: 0 },
      { duration: 16 },
      { duration: 481 },
    ])
      expect(availabilityInput.safeParse({ ...valid, ...change }).success).toBe(
        false,
      );
  });
  it("rejects reversed, oversized and cross-day windows", () => {
    for (const endsAt of [
      date("08:00"),
      date("18:00"),
      new Date("2030-01-02T10:00:00+05:30"),
    ])
      expect(
        availabilityInput.safeParse({ ...valid, endsAt: endsAt.toISOString() })
          .success,
      ).toBe(false);
    expect(
      availabilityInput.safeParse({ ...valid, startsAt: "invalid" }).success,
    ).toBe(false);
  });
});
