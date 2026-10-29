import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { adminDb as admin } from "../../scripts/local-admin-db";
import { db } from "../../src/lib/db";
import { withActor } from "../../src/lib/tenant-context";
import { createOrganization } from "../../src/modules/organizations/service";
import { createDoctor } from "../../src/modules/calling/service";
import {
  changeDoctorSchedule,
  doctorSchedules,
} from "../../src/modules/clinic/schedule-service";
import * as clinic from "../../src/modules/clinic/service";
import { clinicDate } from "../../src/modules/clinic/time";
const users = Array.from({ length: 5 }, () => randomUUID());
const [a, b, member, display, manager] = users;
const orgs: string[] = [];
let org: string,
  foreign: string,
  doctor: string,
  otherDoctor: string,
  lead: string;
const day = clinicDate(new Date(Date.now() + 5 * 86400000));
const at = (t: string) => new Date(`${day}T${t}:00+05:30`).toISOString();
const policy = {
  duration: 30,
  weekly: Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    start: 540,
    end: 1020,
    breakStart: 720,
    breakEnd: 780,
  })),
};
const query = () => ({
  doctorId: doctor,
  startsAt: at("11:30"),
  endsAt: at("13:30"),
  duration: 60,
});
beforeAll(async () => {
  await admin.user.createMany({
    data: users.map((id) => ({
      id,
      name: "Synthetic schedule fixture",
      email: `schedule-${id}@example.com`,
      emailVerified: true,
    })),
  });
  org = (
    await createOrganization(a, {
      name: "Synthetic Hours",
      slug: `hours-${randomUUID()}`,
    })
  ).id;
  orgs.push(org);
  foreign = (
    await createOrganization(b, {
      name: "Synthetic Foreign Hours",
      slug: `hours-${randomUUID()}`,
    })
  ).id;
  orgs.push(foreign);
  await admin.membership.createMany({
    data: [
      { organizationId: org, userId: member, role: "MEMBER" },
      { organizationId: org, userId: display, role: "DISPLAY" },
      { organizationId: org, userId: manager, role: "ADMIN" },
    ],
  });
  doctor = (
    await createDoctor(a, org, {
      name: "Synthetic Scheduled Doctor",
      room: "H1",
      resource: "hours doctor",
    })
  ).id;
  otherDoctor = (
    await createDoctor(b, foreign, {
      name: "Synthetic Other Doctor",
      room: "H2",
      resource: "hours doctor",
    })
  ).id;
  lead = (
    await clinic.createLead(a, org, {
      name: "Synthetic Hours Patient",
      phone: "+12025550101",
      email: "",
      source: "PHONE",
    })
  ).id;
});
afterAll(async () => {
  try {
    await admin.organization.deleteMany({ where: { id: { in: orgs } } });
    await admin.user.deleteMany({ where: { id: { in: users } } });
  } finally {
    await admin.$disconnect();
    await db.$disconnect();
  }
});
describe("tenant-authorized doctor schedules", () => {
  it("configures persisted hours and overrides requested suggestion duration", async () => {
    await changeDoctorSchedule(a, org, doctor, 0, "weekly", policy);
    const slots = await clinic.suggestAppointments(a, org, lead, query());
    expect(slots.map((s) => s.startsAt)).toEqual([at("11:30"), at("13:00")]);
    expect(
      new Date(slots[0].endsAt).getTime() -
        new Date(slots[0].startsAt).getTime(),
    ).toBe(1800000);
  });
  it("denies role/tenant/foreign doctor writes and display reads; RLS blocks foreign row mutation", async () => {
    for (const [actor, tenant, id] of [
      [b, org, doctor],
      [member, org, doctor],
      [display, org, doctor],
      [a, org, otherDoctor],
    ] as const)
      await expect(
        changeDoctorSchedule(actor, tenant, id, 1, "weekly", policy),
      ).rejects.toThrow("Access denied");
    await expect(doctorSchedules(display, org)).rejects.toThrow(
      "Access denied",
    );
    expect(await doctorSchedules(member, org)).toHaveLength(1);
    await withActor(
      b,
      async (tx) => {
        expect(
          await tx.doctor.updateMany({
            where: { id: doctor },
            data: { scheduleVersion: { increment: 1 } },
          }),
        ).toEqual({ count: 0 });
      },
      foreign,
    );
  });
  it("serializes concurrent edits and records one successful audit", async () => {
    const before = await admin.auditEvent.count({
      where: { organizationId: org, action: "clinic.schedule.weekly" },
    });
    const results = await Promise.allSettled([
      changeDoctorSchedule(a, org, doctor, 1, "weekly", policy),
      changeDoctorSchedule(manager, org, doctor, 1, "weekly", policy),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await admin.auditEvent.count({
        where: { organizationId: org, action: "clinic.schedule.weekly" },
      }),
    ).toBe(before + 1);
  });
  it("leave blocks suggestions and direct bookings; removal restores availability", async () => {
    await changeDoctorSchedule(manager, org, doctor, 2, "leave", day);
    expect(await clinic.suggestAppointments(a, org, lead, query())).toEqual([]);
    await expect(
      clinic.bookAppointment(a, org, lead, {
        resource: "hours doctor",
        startsAt: at("09:00"),
        endsAt: at("09:30"),
      }),
    ).rejects.toThrow("working hours");
    await changeDoctorSchedule(a, org, doctor, 3, "removeLeave", day);
    expect(
      await clinic.suggestAppointments(a, org, lead, query()),
    ).toHaveLength(2);
  });
  it("rejects bypassed duration, break and reschedule requests; preserves booked state", async () => {
    for (const [start, end] of [
      ["09:00", "10:00"],
      ["12:00", "12:30"],
      ["08:00", "08:30"],
    ])
      await expect(
        clinic.bookAppointment(a, org, lead, {
          resource: "hours doctor",
          startsAt: at(start),
          endsAt: at(end),
        }),
      ).rejects.toThrow("working hours");
    const booking = await clinic.bookAppointment(a, org, lead, {
      resource: "hours doctor",
      startsAt: at("09:00"),
      endsAt: at("09:30"),
    });
    await expect(
      clinic.rescheduleAppointment(a, org, booking.id, {
        resource: "hours doctor",
        startsAt: at("12:00"),
        endsAt: at("12:30"),
      }),
    ).rejects.toThrow("working hours");
    await expect(
      changeDoctorSchedule(a, org, doctor, 4, "leave", day),
    ).rejects.toThrow("active appointment");
    expect(
      (await admin.doctor.findUniqueOrThrow({ where: { id: doctor } }))
        .scheduleVersion,
    ).toBe(4);
  });
  it("booking and conflicting leave cannot both commit under concurrency", async () => {
    const otherDay = clinicDate(new Date(Date.now() + 6 * 86400000));
    const results = await Promise.allSettled([
      changeDoctorSchedule(a, org, doctor, 4, "leave", otherDay),
      clinic.bookAppointment(a, org, lead, {
        resource: "hours doctor",
        startsAt: `${otherDay}T09:00:00+05:30`,
        endsAt: `${otherDay}T09:30:00+05:30`,
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});
