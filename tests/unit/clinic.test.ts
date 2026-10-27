import { describe, expect, it } from "vitest";
import {
  appointmentInput,
  leadInput,
  leadQuery,
} from "../../src/modules/clinic/validation";
import { checkAppointmentTransition } from "../../src/modules/clinic/workflow";
import {
  clinicDate,
  dayRange,
  displayTime,
  fromLocal,
  localInput,
} from "../../src/modules/clinic/time";
import type { AppointmentStatus } from "../../src/generated/prisma/enums";
describe("clinic inputs and time", () => {
  it("accepts a phone-only lead, normalizes phone/email and rejects invalid sources", () => {
    expect(
      leadInput.parse({
        name: "Synthetic Lead",
        phone: "+91 (987) 654-3210",
        source: "PHONE",
      }),
    ).toEqual({
      name: "Synthetic Lead",
      phone: "+919876543210",
      source: "PHONE",
      email: null,
    });
    expect(
      leadInput.parse({
        name: "Synthetic Lead",
        phone: "9876543210",
        email: "TEST@example.com",
        source: "REFERRAL",
      }).email,
    ).toBe("test@example.com");
    for (const change of [
      { phone: "abc12345" },
      { phone: "12" },
      { source: "unknown" },
      { email: "invalid" },
    ])
      expect(
        leadInput.safeParse({
          name: "Synthetic Lead",
          phone: "9876543210",
          source: "PHONE",
          ...change,
        }).success,
      ).toBe(false);
  });
  it("rejects zero/reversed/long appointment intervals and normalizes resource labels", () => {
    const data = {
      resource: "  Dr   Synthetic  ",
      startsAt: "2026-11-01T09:00:00+05:30",
      endsAt: "2026-11-01T09:30:00+05:30",
    };
    expect(appointmentInput.parse(data).resource).toBe("dr synthetic");
    for (const endsAt of [
      data.startsAt,
      "2026-11-01T08:30:00+05:30",
      "2026-11-01T18:00:00+05:30",
      "invalid",
    ])
      expect(appointmentInput.safeParse({ ...data, endsAt }).success).toBe(
        false,
      );
  });
  it("handles IST midnight and round trips local minute input to UTC", () => {
    const date = new Date("2026-10-27T18:30:00Z");
    expect(clinicDate(date)).toBe("2026-10-28");
    expect(dayRange("2026-10-28").start.toISOString()).toBe(
      "2026-10-27T18:30:00.000Z",
    );
    expect(dayRange("2026-10-28").end.toISOString()).toBe(
      "2026-10-28T18:30:00.000Z",
    );
    expect(new Date(fromLocal(localInput(date))).toISOString()).toBe(
      date.toISOString(),
    );
    expect(displayTime(date)).toContain("28");
    for (const bad of ["2026-02-30", "2026-13-01", "invalid"])
      expect(() => dayRange(bad)).toThrow();
    for (const bad of [
      "2026-01-01T25:00",
      "2026-02-30T09:00",
      "2026-01-01T09:00Z",
    ])
      expect(() => fromLocal(bad)).toThrow();
  });
  it("bounds pagination and rejects arbitrary filters", () => {
    expect(leadQuery.parse({}).page).toBe(1);
    for (const change of [
      { page: 0 },
      { page: "invalid" },
      { status: "ADMIN" },
      { search: "x".repeat(101) },
    ])
      expect(leadQuery.safeParse(change).success).toBe(false);
  });
});
describe("appointment lifecycle", () => {
  // Expected business contract is independent of the implementation's transition table.
  const statuses: AppointmentStatus[] = [
    "SCHEDULED",
    "CONFIRMED",
    "CHECKED_IN",
    "COMPLETED",
    "CANCELLED",
    "NO_SHOW",
  ];
  const permitted = new Set([
    "SCHEDULED:CONFIRMED",
    "SCHEDULED:CHECKED_IN",
    "SCHEDULED:CANCELLED",
    "SCHEDULED:NO_SHOW",
    "CONFIRMED:CHECKED_IN",
    "CONFIRMED:CANCELLED",
    "CONFIRMED:NO_SHOW",
    "CHECKED_IN:COMPLETED",
    "CHECKED_IN:CANCELLED",
  ]);
  for (const from of statuses) {
    for (const to of statuses) {
      it(`${from} → ${to}`, () => {
        const run = () =>
          checkAppointmentTransition(
            from,
            to,
            new Date("2026-01-01T00:00Z"),
            new Date("2026-01-02T00:00Z"),
          );
        if (permitted.has(`${from}:${to}`)) expect(run).not.toThrow();
        else expect(run).toThrow();
      });
    }
  }
  it("cannot mark attendance or no-show before the appointment starts", () => {
    for (const to of ["CHECKED_IN", "NO_SHOW"] as const)
      expect(() =>
        checkAppointmentTransition(
          "SCHEDULED",
          to,
          new Date("2026-01-02T00:00Z"),
          new Date("2026-01-01T00:00Z"),
        ),
      ).toThrow("after the appointment starts");
  });
});
