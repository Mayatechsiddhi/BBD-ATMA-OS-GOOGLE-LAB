import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { adminDb as admin } from "../../scripts/local-admin-db";
import { db } from "../../src/lib/db";
import { withActor } from "../../src/lib/tenant-context";
import * as orgs from "../../src/modules/organizations/service";
import * as clinic from "../../src/modules/clinic/service";
import * as calling from "../../src/modules/calling/service";
import { clinicDate } from "../../src/modules/clinic/time";
const run = randomUUID();
const users = Array.from({ length: 5 }, () => randomUUID());
const [a, b, member, display, dual] = users;
const orgIds: string[] = [];
let orgA: string,
  orgB: string,
  doctorA: string,
  doctorB: string,
  patientA: string,
  patientB: string;
const patient = (name: string) => ({
  name,
  phone: "+12025550105",
  email: "",
  source: "WALK_IN",
});
beforeAll(async () => {
  await admin.user.createMany({
    data: users.map((id) => ({
      id,
      name: "Synthetic queue fixture",
      email: `calling-${id}@example.com`,
      emailVerified: true,
    })),
  });
  orgA = (
    await orgs.createOrganization(a, {
      name: "Synthetic queue A",
      slug: `qa-${run}`,
    })
  ).id;
  orgIds.push(orgA);
  orgB = (
    await orgs.createOrganization(b, {
      name: "Synthetic queue B",
      slug: `qb-${run}`,
    })
  ).id;
  orgIds.push(orgB);
  await admin.membership.createMany({
    data: [
      { organizationId: orgA, userId: member, role: "MEMBER" },
      { organizationId: orgA, userId: display, role: "DISPLAY" },
      { organizationId: orgA, userId: dual, role: "OWNER" },
      { organizationId: orgB, userId: dual, role: "OWNER" },
    ],
  });
  doctorA = (
    await calling.createDoctor(a, orgA, {
      name: "Synthetic doctor A",
      room: "1",
      resource: `resource-a-${run}`,
    })
  ).id;
  doctorB = (
    await calling.createDoctor(b, orgB, {
      name: "Synthetic doctor B",
      room: "2",
      resource: `resource-b-${run}`,
    })
  ).id;
  patientA = (
    await calling.registerPatient(a, orgA, patient("Synthetic patient A"))
  ).id;
  patientB = (
    await calling.registerPatient(b, orgB, patient("Synthetic patient B"))
  ).id;
});
afterAll(async () => {
  await admin.organization.deleteMany({ where: { id: { in: orgIds } } });
  await admin.user.deleteMany({ where: { id: { in: users } } });
  await Promise.all([admin.$disconnect(), db.$disconnect()]);
});
describe("doctor calling security and persistence", () => {
  it("registers existing leads idempotently without duplicating private data", async () => {
    const p = await admin.patient.findUniqueOrThrow({
      where: { id: patientA },
    });
    expect((await calling.registerLead(a, orgA, p.leadId)).id).toBe(patientA);
    expect(
      await admin.patient.count({
        where: { organizationId: orgA, leadId: p.leadId },
      }),
    ).toBe(1);
    expect(
      (
        await calling.reception(a, orgA, { search: "Synthetic patient A" })
      ).patients.map((p) => p.id),
    ).toEqual([patientA]);
  });
  it("denies all foreign service selectors and read-only writes", async () => {
    const before = await admin.auditEvent.count({
      where: { organizationId: orgB },
    });
    await expect(calling.reception(a, orgB)).rejects.toThrow("Access denied");
    await expect(calling.board(a, orgB)).rejects.toThrow("Access denied");
    await expect(
      calling.issueToken(a, orgA, { doctorId: doctorB, patientId: patientA }),
    ).rejects.toThrow();
    await expect(
      calling.issueToken(a, orgA, { doctorId: doctorA, patientId: patientB }),
    ).rejects.toThrow();
    await expect(
      calling.updateDoctor(a, orgA, doctorB, { name: "Denied", room: "3" }),
    ).rejects.toThrow();
    await expect(
      calling.registerPatient(member, orgA, patient("Denied")),
    ).rejects.toThrow();
    await expect(
      calling.createDoctor(member, orgA, {
        name: "Denied",
        room: "3",
        resource: "denied",
      }),
    ).rejects.toThrow();
    expect(
      await admin.auditEvent.count({ where: { organizationId: orgB } }),
    ).toBe(before);
  });
  it("serializes daily issuance, one active call and lifecycle actions with audit", async () => {
    const p1 = await calling.registerPatient(
      a,
      orgA,
      patient("Synthetic concurrent one"),
    );
    const p2 = await calling.registerPatient(
      a,
      orgA,
      patient("Synthetic concurrent two"),
    );
    const tokens = await Promise.all(
      [p1, p2].map((p) =>
        calling.issueToken(a, orgA, { doctorId: doctorA, patientId: p.id }),
      ),
    );
    expect(new Set(tokens.map((t) => t.number)).size).toBe(2);
    const results = await Promise.allSettled(
      tokens.map((t) => calling.actOnToken(a, orgA, t.id, "CALL")),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const current = await admin.queueToken.findFirstOrThrow({
      where: { organizationId: orgA, status: "CALLED" },
    });
    const before = (await calling.board(display, orgA)).revision;
    expect(
      (await calling.actOnToken(a, orgA, current.id, "RECALL")).callCount,
    ).toBe(2);
    expect((await calling.board(display, orgA)).revision).not.toBe(before);
    await calling.actOnToken(a, orgA, current.id, "SKIP");
    await expect(
      calling.actOnToken(a, orgA, current.id, "RECALL"),
    ).rejects.toThrow("not allowed");
    await calling.actOnToken(a, orgA, current.id, "CALL");
    expect(
      (await calling.actOnToken(a, orgA, current.id, "COMPLETE")).completedAt,
    ).not.toBeNull();
    await expect(
      calling.actOnToken(a, orgA, current.id, "CALL"),
    ).rejects.toThrow();
    const events = await admin.auditEvent.findMany({
      where: { subjectId: current.id },
    });
    expect(events.map((e) => e.action)).toEqual(
      expect.arrayContaining([
        "clinic.token.issued",
        "clinic.token.call",
        "clinic.token.recall",
        "clinic.token.skip",
        "clinic.token.complete",
      ]),
    );
  });
  it("binds tokens to tenant/patient/appointment using composite foreign keys", async () => {
    const p = await admin.patient.findUniqueOrThrow({
      where: { id: patientA },
    });
    await expect(
      withActor(
        a,
        (tx) =>
          tx.queueToken.create({
            data: {
              organizationId: orgA,
              patientId: patientB,
              leadId: p.leadId,
              doctorId: doctorA,
              day: clinicDate(),
              number: 90000,
            },
          }),
        orgA,
      ),
    ).rejects.toThrow();
    await expect(
      withActor(
        a,
        (tx) =>
          tx.queueToken.create({
            data: {
              organizationId: orgA,
              patientId: patientA,
              leadId: p.leadId,
              doctorId: doctorB,
              day: clinicDate(),
              number: 90001,
            },
          }),
        orgA,
      ),
    ).rejects.toThrow();
    expect(await db.patient.findMany()).toEqual([]);
    expect(await db.doctor.findMany()).toEqual([]);
    expect(await db.queueToken.findMany()).toEqual([]);
    await expect(
      withActor(
        a,
        (tx) =>
          tx.$executeRaw`UPDATE public."Patient" SET "organizationId"=${orgB} WHERE id=${patientA}`,
        orgA,
      ),
    ).rejects.toThrow();
    await expect(
      withActor(
        a,
        (tx) => tx.patient.delete({ where: { id: patientA } }),
        orgA,
      ),
    ).rejects.toThrow();
  });
  it("limits display-only accounts to non-identifying board data in services and RLS", async () => {
    const board = await calling.board(display, orgA);
    expect(board.doctors.map((d) => d.id)).toContain(doctorA);
    const encoded = JSON.stringify(board);
    for (const value of ["Synthetic patient A", "+12025550105", patientA])
      expect(encoded).not.toContain(value);
    await expect(calling.reception(display, orgA)).rejects.toThrow();
    await expect(calling.board(display, orgA, "read")).rejects.toThrow();
    await expect(clinic.listLeads(display, orgA)).rejects.toThrow();
    await expect(
      calling.issueToken(display, orgA, {
        doctorId: doctorA,
        patientId: patientA,
      }),
    ).rejects.toThrow();
    await withActor(
      display,
      async (tx) => {
        expect(await tx.patient.findMany()).toEqual([]);
        expect(await tx.clinicLead.findMany()).toEqual([]);
        expect(await tx.appointment.findMany()).toEqual([]);
        expect(await tx.contact.findMany()).toEqual([]);
        expect(await tx.auditEvent.findMany()).toEqual([]);
        expect(
          (await tx.doctor.findMany()).every((d) => d.organizationId === orgA),
        ).toBe(true);
      },
      orgA,
    );
    await expect(calling.board(display, orgB)).rejects.toThrow();
  });
  it("converts today's appointment atomically and synchronizes completion/cancellation", async () => {
    const lead = await clinic.createLead(
      a,
      orgA,
      patient("Synthetic appointment patient"),
    );
    // The existing booking API accepts future times. Move fixture time to the
    // current clinic day to exercise arrival without changing the system clock.
    const appt = await clinic.bookAppointment(a, orgA, lead.id, {
      resource: `appt-${run}`,
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      endsAt: new Date(Date.now() + 88200000).toISOString(),
    });
    await admin.appointment.update({
      where: { id: appt.id },
      data: { startsAt: new Date(), endsAt: new Date(Date.now() + 1800000) },
    });
    const doctor = await calling.createDoctor(a, orgA, {
      name: "Synthetic appointment doctor",
      room: "4",
      resource: `appt-${run}`,
    });
    await expect(
      calling.issueToken(a, orgA, {
        doctorId: doctorA,
        appointmentId: appt.id,
      }),
    ).rejects.toThrow("matching");
    const token = await calling.issueToken(a, orgA, {
      doctorId: doctor.id,
      appointmentId: appt.id,
    });
    await expect(
      calling.issueToken(a, orgA, {
        doctorId: doctor.id,
        appointmentId: appt.id,
      }),
    ).rejects.toThrow();
    await expect(
      clinic.rescheduleAppointment(a, orgA, appt.id, {
        resource: `appt-${run}`,
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        endsAt: new Date(Date.now() + 88200000).toISOString(),
      }),
    ).rejects.toThrow("queue token");
    await calling.actOnToken(a, orgA, token.id, "CALL");
    expect(
      (await admin.appointment.findUniqueOrThrow({ where: { id: appt.id } }))
        .status,
    ).toBe("CHECKED_IN");
    await calling.actOnToken(a, orgA, token.id, "COMPLETE");
    expect(
      (await admin.appointment.findUniqueOrThrow({ where: { id: appt.id } }))
        .status,
    ).toBe("COMPLETED");
    const lead2 = await clinic.createLead(
      a,
      orgA,
      patient("Synthetic cancelled appointment"),
    );
    const appt2 = await clinic.bookAppointment(a, orgA, lead2.id, {
      resource: `appt-${run}`,
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      endsAt: new Date(Date.now() + 88200000).toISOString(),
    });
    await admin.appointment.update({
      where: { id: appt2.id },
      data: { startsAt: new Date(), endsAt: new Date(Date.now() + 1800000) },
    });
    const token2 = await calling.issueToken(a, orgA, {
      doctorId: doctor.id,
      appointmentId: appt2.id,
    });
    await clinic.transitionAppointment(a, orgA, appt2.id, "CANCELLED");
    expect(
      (await admin.queueToken.findUniqueOrThrow({ where: { id: token2.id } }))
        .status,
    ).toBe("CANCELLED");
  });
  it("rolls token writes back when audit insertion fails and supports safe past-day closure", async () => {
    const p = await admin.patient.findUniqueOrThrow({
      where: { id: patientA },
    });
    await expect(
      withActor(
        a,
        async (tx) => {
          await tx.queueToken.create({
            data: {
              organizationId: orgA,
              patientId: patientA,
              leadId: p.leadId,
              doctorId: doctorA,
              day: clinicDate(),
              number: 91000,
            },
          });
          await tx.auditEvent.create({
            data: { organizationId: orgB, actorId: a, action: "denied.audit" },
          });
        },
        orgA,
      ),
    ).rejects.toThrow();
    expect(
      await admin.queueToken.count({
        where: { organizationId: orgA, number: 91000 },
      }),
    ).toBe(0);
    const token = await calling.issueToken(a, orgA, {
      doctorId: doctorA,
      patientId: patientA,
    });
    const yesterday = clinicDate(new Date(Date.now() - 86400000));
    await admin.queueToken.update({
      where: { id: token.id },
      data: { day: yesterday },
    });
    await expect(calling.actOnToken(a, orgA, token.id, "CALL")).rejects.toThrow(
      "today",
    );
    expect(
      (await calling.reception(a, orgA, { day: yesterday })).tokens.some(
        (t) => t.id === token.id,
      ),
    ).toBe(true);
    expect((await calling.actOnToken(a, orgA, token.id, "CANCEL")).status).toBe(
      "CANCELLED",
    );
  });
  it("permits verified display invitations but denies future-day appointment tokens", async () => {
    const invitation = await orgs.createInvitation(a, orgA, {
      email: `calling-${display}@example.com`,
      role: "DISPLAY",
    });
    // Existing membership stays DISPLAY; invitation acceptance cannot escalate it.
    await orgs.acceptInvitation(display, invitation);
    expect(
      (
        await admin.membership.findUniqueOrThrow({
          where: {
            organizationId_userId: { organizationId: orgA, userId: display },
          },
        })
      ).role,
    ).toBe("DISPLAY");
    const lead = await clinic.createLead(
      a,
      orgA,
      patient("Synthetic future arrival"),
    );
    const doctor = await calling.createDoctor(a, orgA, {
      name: "Synthetic future doctor",
      room: "5",
      resource: `future-${run}`,
    });
    const appointment = await clinic.bookAppointment(a, orgA, lead.id, {
      resource: doctor.resource,
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      endsAt: new Date(Date.now() + 88200000).toISOString(),
    });
    await expect(
      calling.issueToken(a, orgA, {
        doctorId: doctor.id,
        appointmentId: appointment.id,
      }),
    ).rejects.toThrow("today");
    expect(
      await admin.queueToken.count({
        where: { appointmentId: appointment.id },
      }),
    ).toBe(0);
  });
  it("reissues cancelled visits without recycling numbers or losing appointment history", async () => {
    const p = await calling.registerPatient(
      a,
      orgA,
      patient("Synthetic reissued visit"),
    );
    const first = await calling.issueToken(a, orgA, {
      doctorId: doctorA,
      patientId: p.id,
    });
    await calling.actOnToken(a, orgA, first.id, "CANCEL");
    const second = await calling.issueToken(a, orgA, {
      doctorId: doctorA,
      patientId: p.id,
    });
    expect(second.number).toBeGreaterThan(first.number);
    expect(second.id).not.toBe(first.id);
    await calling.actOnToken(a, orgA, second.id, "CANCEL");
    const lead = await clinic.createLead(
      a,
      orgA,
      patient("Synthetic appointment reissue"),
    );
    const doctor = await calling.createDoctor(a, orgA, {
      name: "Synthetic reissue doctor",
      room: "6",
      resource: `reissue-${run}`,
    });
    const appt = await clinic.bookAppointment(a, orgA, lead.id, {
      resource: doctor.resource,
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      endsAt: new Date(Date.now() + 88200000).toISOString(),
    });
    await admin.appointment.update({
      where: { id: appt.id },
      data: { startsAt: new Date(), endsAt: new Date(Date.now() + 1800000) },
    });
    const original = await calling.issueToken(a, orgA, {
      doctorId: doctor.id,
      appointmentId: appt.id,
    });
    await calling.actOnToken(a, orgA, original.id, "CANCEL");
    const reissued = await calling.issueToken(a, orgA, {
      doctorId: doctor.id,
      appointmentId: appt.id,
    });
    expect(reissued.number).toBeGreaterThan(original.number);
    expect(
      await admin.queueToken.count({ where: { appointmentId: appt.id } }),
    ).toBe(2);
  });
  it("rejects a forged context, contains dual-membership queries and revokes displays immediately", async () => {
    await withActor(
      a,
      async (tx) => {
        expect(await tx.patient.findMany()).toEqual([]);
        expect(await tx.queueToken.findMany()).toEqual([]);
      },
      orgB,
    );
    await withActor(
      dual,
      async (tx) => {
        expect(
          (await tx.patient.findMany()).every((p) => p.organizationId === orgA),
        ).toBe(true);
        expect(
          (await tx.queueToken.findMany()).every(
            (t) => t.organizationId === orgA,
          ),
        ).toBe(true);
      },
      orgA,
    );
    await orgs.changeMember(a, orgA, display, null);
    await expect(calling.board(display, orgA)).rejects.toThrow();
  });
});
