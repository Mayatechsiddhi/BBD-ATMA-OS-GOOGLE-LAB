import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb as admin } from "../../scripts/local-admin-db";
import { db } from "../../src/lib/db";
import { withActor } from "../../src/lib/tenant-context";
import { AccessError } from "../../src/modules/organizations/policy";
import { createOrganization } from "../../src/modules/organizations/service";
import * as clinic from "../../src/modules/clinic/service";
import { clinicDate } from "../../src/modules/clinic/time";
const users = Array.from({ length: 4 }, () => randomUUID());
const [a, b, member, manager] = users;
const orgs: string[] = [];
let orgA: string,
  orgB: string,
  leadA: string,
  leadB: string,
  appointmentB: string,
  followB: string;
const suffix = randomUUID();
const leadData = (name: string) => ({
  name,
  phone: "+919876543210",
  email: "",
  source: "PHONE",
});
const windowAt = (resource: string, days = 5) => ({
  resource,
  startsAt: new Date(Date.now() + days * 86400000).toISOString(),
  endsAt: new Date(Date.now() + days * 86400000 + 1800000).toISOString(),
});
async function deny(promise: Promise<unknown>, expected = "42501") {
  try {
    await promise;
    throw new Error("Expected database denial");
  } catch (error) {
    const e = error as {
      code?: string;
      meta?: {
        code?: string;
        driverAdapterError?: { cause?: { originalCode?: string } };
      };
    };
    expect(
      e.meta?.code ??
        e.meta?.driverAdapterError?.cause?.originalCode ??
        (e.code === "P2003" ? "23503" : e.code),
    ).toBe(expected);
  }
}
beforeAll(async () => {
  await admin.user.createMany({
    data: users.map((id) => ({
      id,
      name: "Synthetic clinic fixture",
      email: `clinic-${id}@example.com`,
      emailVerified: true,
    })),
  });
  orgA = (
    await createOrganization(a, {
      name: "Synthetic Clinic A",
      slug: `clinic-a-${suffix}`,
    })
  ).id;
  orgs.push(orgA);
  orgB = (
    await createOrganization(b, {
      name: "Synthetic Clinic B",
      slug: `clinic-b-${suffix}`,
    })
  ).id;
  orgs.push(orgB);
  await admin.membership.createMany({
    data: [
      { organizationId: orgA, userId: member, role: "MEMBER" },
      { organizationId: orgA, userId: manager, role: "ADMIN" },
    ],
  });
  leadA = (await clinic.createLead(a, orgA, leadData(`Synthetic A ${suffix}`)))
    .id;
  leadB = (await clinic.createLead(b, orgB, leadData(`Synthetic B ${suffix}`)))
    .id;
  await clinic.bookAppointment(a, orgA, leadA, windowAt("synthetic a"));
  await clinic.createFollowUp(a, orgA, leadA, {
    title: "Synthetic A follow-up",
    dueAt: windowAt("unused").startsAt,
  });
  appointmentB = (
    await clinic.bookAppointment(b, orgB, leadB, windowAt("synthetic b"))
  ).id;
  followB = (
    await clinic.createFollowUp(b, orgB, leadB, {
      title: "Synthetic B follow-up",
      dueAt: windowAt("unused").startsAt,
    })
  ).id;
});
afterAll(async () => {
  try {
    await admin.organization.deleteMany({ where: { id: { in: orgs } } });
    await admin.user.deleteMany({ where: { id: { in: users } } });
  } finally {
    await Promise.all([admin.$disconnect(), db.$disconnect()]);
  }
});
describe("clinic tenant services and database boundaries", () => {
  it("persists normalized lead data, search and permitted lifecycle changes with audit", async () => {
    const lead = await clinic.createLead(manager, orgA, {
      ...leadData(`Lifecycle ${suffix}`),
      phone: "+91 (987) 654-3210",
    });
    expect(lead.phone).toBe("+919876543210");
    expect(lead.email).toBeNull();
    await clinic.updateLead(a, orgA, lead.id, {
      ...leadData(`Updated ${suffix}`),
      source: "REFERRAL",
    });
    expect(
      (await clinic.listLeads(a, orgA, { search: `Updated ${suffix}` })).total,
    ).toBe(1);
    for (const status of ["CONTACTED", "QUALIFIED", "CONVERTED"])
      await clinic.transitionLead(a, orgA, lead.id, status);
    await expect(
      clinic.transitionLead(a, orgA, lead.id, "NEW"),
    ).rejects.toThrow("not allowed");
    expect(
      await admin.auditEvent.count({
        where: { organizationId: orgA, subjectId: lead.id },
      }),
    ).toBe(5);
  });
  it("denies foreign services, search and known foreign IDs without mutations or audit", async () => {
    const before = await admin.auditEvent.count({
      where: { organizationId: orgB },
    });
    await expect(clinic.listLeads(a, orgB)).rejects.toBeInstanceOf(AccessError);
    expect(
      (await clinic.listLeads(a, orgA, { search: `Synthetic B ${suffix}` }))
        .total,
    ).toBe(0);
    await Promise.all(
      [
        clinic.getLead(a, orgA, leadB),
        clinic.updateLead(a, orgA, leadB, leadData("Attempt")),
        clinic.transitionLead(a, orgA, leadB, "CONTACTED"),
        clinic.bookAppointment(a, orgA, leadB, windowAt("foreign")),
        clinic.createFollowUp(a, orgA, leadB, {
          title: "Attempt",
          dueAt: windowAt("unused").startsAt,
        }),
        clinic.rescheduleAppointment(
          a,
          orgA,
          appointmentB,
          windowAt("foreign"),
        ),
        clinic.transitionAppointment(a, orgA, appointmentB, "CANCELLED"),
        clinic.updateFollowUp(a, orgA, followB, {
          title: "Attempt",
          dueAt: windowAt("unused").startsAt,
        }),
        clinic.transitionFollowUp(a, orgA, followB, "DONE"),
        clinic.dashboard(a, orgB),
        clinic.listAppointments(a, orgB),
        clinic.listFollowUps(a, orgB),
      ].map((promise) => expect(promise).rejects.toBeInstanceOf(AccessError)),
    );
    expect(
      await admin.auditEvent.count({ where: { organizationId: orgB } }),
    ).toBe(before);
    expect(
      (
        await admin.appointment.findUniqueOrThrow({
          where: { id: appointmentB },
        })
      ).status,
    ).toBe("SCHEDULED");
    expect(
      (await admin.followUp.findUniqueOrThrow({ where: { id: followB } }))
        .status,
    ).toBe("OPEN");
  });
  it("forces RLS on all new tables and denies contextless/forged-tenant reads", async () => {
    expect(await db.clinicLead.count()).toBe(0);
    expect(await db.appointment.count()).toBe(0);
    expect(await db.followUp.count()).toBe(0);
    await withActor(
      a,
      async (tx) => {
        expect(await tx.clinicLead.count()).toBe(0);
        expect(await tx.appointment.count()).toBe(0);
        expect(await tx.followUp.count()).toBe(0);
      },
      orgB,
    );
    await withActor(
      a,
      async (tx) => {
        expect(
          (
            await tx.clinicLead.findMany({
              include: { appointments: true, followUps: true },
            })
          ).every((row) => row.organizationId === orgA),
        ).toBe(true);
        expect(
          await tx.clinicLead.findMany({
            where: { name: { contains: `Synthetic B ${suffix}` } },
          }),
        ).toEqual([]);
        const [exported] = await tx.$queryRaw<
          { foreignCount: number }[]
        >`SELECT count(*)::int AS "foreignCount" FROM public."ClinicLead" WHERE "organizationId"=${orgB}`;
        expect(exported.foreignCount).toBe(0);
        expect(await tx.appointment.count()).toBeGreaterThan(0);
        expect(await tx.followUp.count()).toBeGreaterThan(0);
        const [aggregate] = await tx.$queryRaw<
          { payload: unknown }[]
        >`SELECT json_build_object('leads',(SELECT json_agg(id) FROM public."ClinicLead"),'appointments',(SELECT json_agg(id) FROM public."Appointment"),'followUps',(SELECT json_agg(id) FROM public."FollowUp")) AS payload`;
        const serialized = JSON.stringify(aggregate.payload);
        expect(serialized).toContain(leadA);
        for (const foreignId of [leadB, appointmentB, followB])
          expect(serialized).not.toContain(foreignId);
        expect(
          await tx.clinicLead.updateMany({
            where: { id: leadB },
            data: { name: "Synthetic denied edit" },
          }),
        ).toEqual({ count: 0 });
        expect(
          await tx.appointment.updateMany({
            where: { id: appointmentB },
            data: { status: "CANCELLED" },
          }),
        ).toEqual({ count: 0 });
        expect(
          await tx.followUp.updateMany({
            where: { id: followB },
            data: { status: "CANCELLED" },
          }),
        ).toEqual({ count: 0 });
      },
      orgA,
    );
  });
  it("enforces composite tenant foreign keys and immutable ownership columns", async () => {
    await withActor(
      a,
      async (tx) => {
        await deny(
          tx.appointment.create({
            data: {
              organizationId: orgA,
              leadId: leadB,
              ...{
                resource: "synthetic foreign",
                startsAt: new Date(windowAt("unused").startsAt),
                endsAt: new Date(windowAt("unused").endsAt),
              },
            },
          }),
          "23503",
        );
      },
      orgA,
    );
    await withActor(
      a,
      async (tx) => {
        await deny(
          tx.followUp.create({
            data: {
              organizationId: orgA,
              leadId: leadB,
              title: "Synthetic invalid reference",
              dueAt: new Date(windowAt("unused").startsAt),
            },
          }),
          "23503",
        );
      },
      orgA,
    );
    await withActor(
      a,
      async (tx) => {
        await deny(
          tx.clinicLead.update({
            where: { id: leadA },
            data: { organizationId: orgB },
          }),
        );
      },
      orgA,
    );
    await withActor(
      a,
      async (tx) => {
        await deny(
          tx.appointment.create({
            data: {
              organizationId: orgB,
              leadId: leadB,
              resource: "synthetic foreign",
              startsAt: new Date(windowAt("unused").startsAt),
              endsAt: new Date(windowAt("unused").endsAt),
            },
          }),
        );
      },
      orgA,
    );
    await deny(db.clinicLead.deleteMany({ where: { id: leadB } }));
    await deny(db.appointment.deleteMany({ where: { id: appointmentB } }));
    await deny(db.followUp.deleteMany({ where: { id: followB } }));
  });
  it("keeps members read-only in services and RLS", async () => {
    const visible = await clinic.getLead(member, orgA, leadA);
    expect(visible.lead.id).toBe(leadA);
    expect(visible.appointments.length).toBeGreaterThan(0);
    expect(visible.followUps.length).toBeGreaterThan(0);
    await Promise.all(
      [
        clinic.createLead(member, orgA, leadData("Denied")),
        clinic.bookAppointment(member, orgA, leadA, windowAt("denied")),
        clinic.createFollowUp(member, orgA, leadA, {
          title: "Denied",
          dueAt: windowAt("unused").startsAt,
        }),
        clinic.transitionLead(member, orgA, leadA, "CONTACTED"),
      ].map((promise) => expect(promise).rejects.toBeInstanceOf(AccessError)),
    );
    await withActor(
      member,
      async (tx) => {
        await deny(
          tx.clinicLead.create({
            data: {
              organizationId: orgA,
              name: "Denied",
              phone: "9876543210",
              source: "PHONE",
            },
          }),
        );
      },
      orgA,
    );
    await withActor(
      member,
      async (tx) => {
        expect(
          await tx.clinicLead.updateMany({
            where: { id: leadA },
            data: { name: "Denied" },
          }),
        ).toEqual({ count: 0 });
      },
      orgA,
    );
    await withActor(
      member,
      async (tx) => {
        await deny(
          tx.appointment.create({
            data: {
              organizationId: orgA,
              leadId: leadA,
              resource: "synthetic denied",
              startsAt: new Date(windowAt("unused").startsAt),
              endsAt: new Date(windowAt("unused").endsAt),
            },
          }),
        );
      },
      orgA,
    );
    await withActor(
      member,
      async (tx) => {
        await deny(
          tx.followUp.create({
            data: {
              organizationId: orgA,
              leadId: leadA,
              title: "Synthetic denied",
              dueAt: new Date(windowAt("unused").startsAt),
            },
          }),
        );
      },
      orgA,
    );
    await withActor(
      member,
      async (tx) => {
        expect(
          await tx.appointment.updateMany({
            where: { leadId: leadA },
            data: { status: "CANCELLED" },
          }),
        ).toEqual({ count: 0 });
        expect(
          await tx.followUp.updateMany({
            where: { leadId: leadA },
            data: { status: "CANCELLED" },
          }),
        ).toEqual({ count: 0 });
      },
      orgA,
    );
  });
  it("serializes competing bookings and permits adjacent slots and other tenants", async () => {
    const lead = await clinic.createLead(
      a,
      orgA,
      leadData("Synthetic concurrency lead"),
    );
    const data = windowAt(`concurrent-${suffix}`, 20);
    const results = await Promise.allSettled([
      clinic.bookAppointment(a, orgA, leadA, data),
      clinic.bookAppointment(manager, orgA, lead.id, {
        ...data,
        resource: data.resource.toUpperCase(),
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    await clinic.bookAppointment(b, orgB, leadB, data);
    const end = new Date(data.endsAt);
    await clinic.bookAppointment(a, orgA, lead.id, {
      ...data,
      startsAt: end.toISOString(),
      endsAt: new Date(end.getTime() + 1800000).toISOString(),
    });
  });
  it("paginates filtered lead searches deterministically without tenant leakage", async () => {
    const prefix = `Synthetic pagination ${suffix}`;
    await admin.clinicLead.createMany({
      data: Array.from({ length: 26 }, (_, index) => ({
        organizationId: orgA,
        name: `${prefix} ${index}`,
        phone: "+12025550101",
        source: "PHONE",
      })),
    });
    const first = await clinic.listLeads(a, orgA, {
      search: prefix,
      status: "NEW",
      page: 1,
    });
    const second = await clinic.listLeads(a, orgA, {
      search: prefix,
      status: "NEW",
      page: 2,
    });
    expect(first.total).toBe(26);
    expect(first.leads).toHaveLength(25);
    expect(second.leads).toHaveLength(1);
    expect(
      new Set([...first.leads, ...second.leads].map((l) => l.id)).size,
    ).toBe(26);
    expect((await clinic.listLeads(b, orgB, { search: prefix })).total).toBe(0);
    await expect(
      clinic.bookAppointment(a, orgA, leadA, windowAt("another resource")),
    ).rejects.toThrow("overlapping");
  });
  it("contains dual-membership context and rolls clinic writes back if audit insertion fails", async () => {
    await admin.membership.create({
      data: { organizationId: orgB, userId: manager, role: "ADMIN" },
    });
    await withActor(
      manager,
      async (tx) => {
        expect(await tx.clinicLead.findMany({ where: { id: leadB } })).toEqual(
          [],
        );
        await deny(
          tx.followUp.create({
            data: {
              organizationId: orgB,
              leadId: leadB,
              title: "Synthetic forbidden context",
              dueAt: new Date(windowAt("unused").startsAt),
            },
          }),
        );
      },
      orgA,
    );
    const name = `Synthetic rollback ${suffix}`;
    await deny(
      withActor(
        a,
        async (tx) => {
          const lead = await tx.clinicLead.create({
            data: { organizationId: orgA, ...leadData(name) },
          });
          await tx.auditEvent.create({
            data: {
              organizationId: orgA,
              actorId: b,
              subjectId: lead.id,
              action: "clinic.synthetic.invalid_audit",
            },
          });
        },
        orgA,
      ),
    );
    expect(
      await admin.clinicLead.count({ where: { organizationId: orgA, name } }),
    ).toBe(0);
  });
  it("rejects overlaps on reschedule and invalid attendance, then persists completion", async () => {
    const lead = await clinic.createLead(
      a,
      orgA,
      leadData("Synthetic attendance"),
    );
    const data = windowAt(`attendance-${suffix}`, 9);
    const first = await clinic.bookAppointment(a, orgA, lead.id, data);
    await expect(
      clinic.transitionAppointment(a, orgA, first.id, "NO_SHOW"),
    ).rejects.toThrow("after the appointment starts");
    await clinic.transitionAppointment(a, orgA, first.id, "CONFIRMED");
    const secondLead = await clinic.createLead(
      a,
      orgA,
      leadData("Synthetic reschedule"),
    );
    const second = await clinic.bookAppointment(
      a,
      orgA,
      secondLead.id,
      windowAt(data.resource, 10),
    );
    await expect(
      clinic.rescheduleAppointment(a, orgA, second.id, data),
    ).rejects.toThrow("overlapping");
    await clinic.rescheduleAppointment(
      a,
      orgA,
      second.id,
      windowAt(data.resource, 11),
    );
    await admin.appointment.update({
      where: { id: first.id },
      data: {
        startsAt: new Date(Date.now() - 1800000),
        endsAt: new Date(Date.now() + 1800000),
      },
    });
    await clinic.transitionAppointment(a, orgA, first.id, "CHECKED_IN");
    await clinic.transitionAppointment(a, orgA, first.id, "COMPLETED");
    await expect(
      clinic.rescheduleAppointment(a, orgA, first.id, data),
    ).rejects.toThrow("Only scheduled");
    await expect(
      clinic.transitionAppointment(a, orgA, first.id, "CONFIRMED"),
    ).rejects.toThrow("not allowed");
  });
  it("tracks follow-up due dates, completion and cancellation with scoped dashboard counts", async () => {
    const f = await clinic.createFollowUp(a, orgA, leadA, {
      title: "Synthetic follow-up",
      dueAt: windowAt("unused").startsAt,
    });
    await clinic.updateFollowUp(manager, orgA, f.id, {
      title: "Updated synthetic task",
      dueAt: windowAt("unused", 8).startsAt,
    });
    await admin.followUp.update({
      where: { id: f.id },
      data: { dueAt: new Date(Date.now() - 60000) },
    });
    const summary = await clinic.dashboard(a, orgA);
    expect(summary.overdueFollowUps).toBe(
      await admin.followUp.count({
        where: {
          organizationId: orgA,
          status: "OPEN",
          dueAt: { lt: new Date() },
        },
      }),
    );
    expect(summary.appointmentsToday).toBe(
      await admin.appointment.count({
        where: {
          organizationId: orgA,
          status: { not: "CANCELLED" },
          startsAt: {
            gte: new Date(`${clinicDate()}T00:00:00+05:30`),
            lt: new Date(
              new Date(`${clinicDate()}T00:00:00+05:30`).getTime() + 86400000,
            ),
          },
        },
      }),
    );
    expect(summary.upcoming.every((x) => x.organizationId === orgA)).toBe(true);
    const completed = await clinic.transitionFollowUp(a, orgA, f.id, "DONE");
    expect(completed.completedAt).not.toBeNull();
    await expect(
      clinic.transitionFollowUp(a, orgA, f.id, "OPEN"),
    ).rejects.toThrow("Only open");
    const cancel = await clinic.createFollowUp(a, orgA, leadA, {
      title: "Synthetic cancel",
      dueAt: windowAt("unused").startsAt,
    });
    expect(
      (await clinic.transitionFollowUp(a, orgA, cancel.id, "CANCELLED"))
        .completedAt,
    ).toBeNull();
    expect(
      (await clinic.listFollowUps(a, orgA, "DONE")).some((x) => x.id === f.id),
    ).toBe(true);
  });
  it("does not create an audit or row when validation, past dates or booking eligibility fail", async () => {
    const lost = await clinic.createLead(
      a,
      orgA,
      leadData("Synthetic lost lead"),
    );
    await clinic.transitionLead(a, orgA, lost.id, "LOST");
    const before = await admin.auditEvent.count({
      where: { organizationId: orgA },
    });
    await expect(
      clinic.bookAppointment(a, orgA, lost.id, windowAt("lost")),
    ).rejects.toThrow("lost lead");
    await expect(
      clinic.bookAppointment(a, orgA, leadA, {
        ...windowAt("past"),
        startsAt: "2000-01-01T09:00:00Z",
        endsAt: "2000-01-01T09:30:00Z",
      }),
    ).rejects.toThrow("future");
    await expect(
      clinic.createFollowUp(a, orgA, leadA, {
        title: "Past task",
        dueAt: "2000-01-01T09:00:00Z",
      }),
    ).rejects.toThrow("future");
    await expect(
      clinic.createLead(a, orgA, { name: "x", phone: "bad", source: "PHONE" }),
    ).rejects.toThrow();
    expect(
      await admin.auditEvent.count({ where: { organizationId: orgA } }),
    ).toBe(before);
  });
});
