import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { adminDb as admin } from "../../scripts/local-admin-db";
import { db } from "../../src/lib/db";
import { createOrganization } from "../../src/modules/organizations/service";
import { createDoctor } from "../../src/modules/calling/service";
import * as clinic from "../../src/modules/clinic/service";
import { clinicDate } from "../../src/modules/clinic/time";
const users = Array.from({ length: 5 }, () => randomUUID());
const [a, b, member, display, dual] = users;
const orgs: string[] = [];
let orgA: string,
  orgB: string,
  lead: string,
  foreignLead: string,
  doctor: string,
  foreignDoctor: string;
const day = clinicDate(new Date(Date.now() + 5 * 86400000));
const at = (t: string) => new Date(`${day}T${t}:00+05:30`).toISOString();
const query = () => ({
  doctorId: doctor,
  startsAt: at("09:00"),
  endsAt: at("11:00"),
  duration: 30,
});
beforeAll(async () => {
  await admin.user.createMany({
    data: users.map((id) => ({
      id,
      name: "Synthetic slot fixture",
      email: `slot-${id}@example.com`,
      emailVerified: true,
    })),
  });
  orgA = (
    await createOrganization(a, {
      name: "Synthetic Slots A",
      slug: `slots-a-${randomUUID()}`,
    })
  ).id;
  orgs.push(orgA);
  orgB = (
    await createOrganization(b, {
      name: "Synthetic Slots B",
      slug: `slots-b-${randomUUID()}`,
    })
  ).id;
  orgs.push(orgB);
  await admin.membership.createMany({
    data: [
      { organizationId: orgA, userId: member, role: "MEMBER" },
      { organizationId: orgA, userId: display, role: "DISPLAY" },
      { organizationId: orgA, userId: dual, role: "ADMIN" },
      { organizationId: orgB, userId: dual, role: "ADMIN" },
    ],
  });
  const data = {
    name: "Synthetic slot lead",
    phone: "+12025550101",
    email: "",
    source: "PHONE",
  };
  lead = (await clinic.createLead(a, orgA, data)).id;
  foreignLead = (await clinic.createLead(b, orgB, data)).id;
  doctor = (
    await createDoctor(a, orgA, {
      name: "Synthetic Slot Doctor",
      room: "S1",
      resource: "slot doctor",
    })
  ).id;
  foreignDoctor = (
    await createDoctor(b, orgB, {
      name: "Synthetic Foreign Doctor",
      room: "S2",
      resource: "slot doctor",
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
describe("authenticated tenant slot suggestions", () => {
  it("returns only projected free times and permits member reads", async () => {
    const slots = await clinic.suggestAppointments(a, orgA, lead, query());
    expect(slots).toHaveLength(5);
    expect(Object.keys(slots[0]).sort()).toEqual([
      "endsAt",
      "resource",
      "startsAt",
    ]);
    expect(
      await clinic.suggestAppointments(member, orgA, lead, query()),
    ).toEqual(slots);
  });
  it("denies foreign organization, doctor, lead and display selectors even for dual members", async () => {
    for (const [actor, org, id, q] of [
      [a, orgB, foreignLead, { ...query(), doctorId: foreignDoctor }],
      [a, orgA, foreignLead, query()],
      [a, orgA, lead, { ...query(), doctorId: foreignDoctor }],
      [dual, orgA, lead, { ...query(), doctorId: foreignDoctor }],
      [display, orgA, lead, query()],
    ] as const)
      await expect(
        clinic.suggestAppointments(actor, org, id, q),
      ).rejects.toThrow("Access denied");
  });
  it("ignores foreign bookings, filters lead conflicts on other resources and sees beyond 100 rows", async () => {
    await clinic.bookAppointment(b, orgB, foreignLead, {
      resource: "slot doctor",
      startsAt: at("09:00"),
      endsAt: at("11:00"),
    });
    expect(
      await clinic.suggestAppointments(a, orgA, lead, query()),
    ).toHaveLength(5);
    const rows = await admin.appointment.createManyAndReturn({
      data: Array.from({ length: 101 }, (_, i) => ({
        organizationId: orgA,
        leadId: lead,
        resource: i === 100 ? "other doctor" : "slot doctor",
        startsAt: new Date(at("09:00")),
        endsAt: new Date(at(i === 100 ? "11:00" : "09:15")),
        status: "SCHEDULED" as const,
      })),
    });
    try {
      expect(await clinic.suggestAppointments(a, orgA, lead, query())).toEqual(
        [],
      );
    } finally {
      await admin.appointment.deleteMany({
        where: { id: { in: rows.map((r) => r.id) } },
      });
    }
  });
  it("rechecks stale suggestions, prevents concurrent duplicates and commits one audit", async () => {
    const [slot] = await clinic.suggestAppointments(a, orgA, lead, query());
    const before = await admin.auditEvent.count({
      where: { organizationId: orgA, action: "clinic.appointment.booked" },
    });
    const results = await Promise.allSettled([
      clinic.bookAppointment(a, orgA, lead, slot),
      clinic.bookAppointment(a, orgA, lead, slot),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expect(clinic.bookAppointment(a, orgA, lead, slot)).rejects.toThrow(
      "overlapping",
    );
    expect(
      await admin.auditEvent.count({
        where: { organizationId: orgA, action: "clinic.appointment.booked" },
      }),
    ).toBe(before + 1);
    expect(
      (await clinic.suggestAppointments(a, orgA, lead, query()))[0].startsAt,
    ).toBe(at("09:30"));
    await expect(
      clinic.bookAppointment(member, orgA, lead, slot),
    ).rejects.toThrow("Access denied");
  });
  it("fails closed on revoked membership, lost leads and invalid horizons", async () => {
    await admin.membership.delete({
      where: { organizationId_userId: { organizationId: orgA, userId: dual } },
    });
    await expect(
      clinic.suggestAppointments(dual, orgA, lead, query()),
    ).rejects.toThrow("Access denied");
    await expect(
      clinic.suggestAppointments(a, orgA, lead, {
        ...query(),
        startsAt: "2035-01-01T09:00:00+05:30",
        endsAt: "2035-01-01T10:00:00+05:30",
      }),
    ).rejects.toThrow("30 days");
    await admin.clinicLead.update({
      where: { id: lead },
      data: { status: "LOST" },
    });
    await expect(
      clinic.suggestAppointments(a, orgA, lead, query()),
    ).rejects.toThrow("lost lead");
  });
});
