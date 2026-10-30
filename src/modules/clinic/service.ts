import type { Prisma } from "@/generated/prisma/client";
import { audit } from "@/modules/organizations/access";
import { moduleAccess } from "@/modules/entitlements/access";
const withOrganization = moduleAccess("clinic");
import { AccessError } from "@/modules/organizations/policy";
import {
  appointmentInput,
  appointmentStatus,
  followUpInput,
  followUpStatus,
  leadInput,
  leadQuery,
  leadStatus,
} from "./validation";
import {
  activeAppointments,
  checkAppointmentTransition,
  ClinicError,
  leadTransitions,
} from "./workflow";
import { clinicDate, dayRange } from "./time";
import { availabilityInput, freeSlots } from "./availability";
import { enforceDoctorSchedule } from "./schedule-service";
import { readSchedule, scheduleAllows } from "./schedule";

async function leadFor(
  tx: Prisma.TransactionClient,
  organizationId: string,
  id: string,
) {
  const lead = await tx.clinicLead.findUnique({
    where: { organizationId_id: { organizationId, id } },
  });
  if (!lead) throw new AccessError();
  return lead;
}
function future(date: Date) {
  if (date <= new Date()) throw new ClinicError("Choose a time in the future.");
}
export async function createLead(
  userId: string,
  organizationId: string,
  input: unknown,
) {
  const data = leadInput.parse(input);
  return withOrganization(userId, organizationId, "crm:write", async (tx) => {
    const lead = await tx.clinicLead.create({
      data: { ...data, organizationId },
    });
    await audit(tx, organizationId, userId, "clinic.lead.created", lead.id);
    return lead;
  });
}
export async function updateLead(
  userId: string,
  organizationId: string,
  id: string,
  input: unknown,
) {
  const data = leadInput.parse(input);
  return withOrganization(userId, organizationId, "crm:write", async (tx) => {
    await leadFor(tx, organizationId, id);
    const lead = await tx.clinicLead.update({
      where: { organizationId_id: { organizationId, id } },
      data,
    });
    await audit(tx, organizationId, userId, "clinic.lead.updated", id);
    return lead;
  });
}
export async function transitionLead(
  userId: string,
  organizationId: string,
  id: string,
  input: unknown,
) {
  const status = leadStatus.parse(input);
  return withOrganization(userId, organizationId, "crm:write", async (tx) => {
    const lead = await leadFor(tx, organizationId, id);
    if (!leadTransitions[lead.status].includes(status))
      throw new ClinicError("That lead status change is not allowed.");
    const updated = await tx.clinicLead.update({
      where: { organizationId_id: { organizationId, id } },
      data: { status },
    });
    await audit(
      tx,
      organizationId,
      userId,
      `clinic.lead.${status.toLowerCase()}`,
      id,
    );
    return updated;
  });
}
export async function listLeads(
  userId: string,
  organizationId: string,
  input: unknown = {},
) {
  const query = leadQuery.parse(input);
  return withOrganization(userId, organizationId, "read", async (tx) => {
    const where: Prisma.ClinicLeadWhereInput = {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { phone: { contains: query.search } },
              { email: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    return {
      page: query.page,
      total: await tx.clinicLead.count({ where }),
      leads: await tx.clinicLead.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (query.page - 1) * 25,
        take: 25,
      }),
    };
  });
}
export async function getLead(
  userId: string,
  organizationId: string,
  id: string,
) {
  return withOrganization(userId, organizationId, "read", async (tx) => ({
    lead: await leadFor(tx, organizationId, id),
    doctors: await tx.doctor
      .findMany({
        where: { organizationId },
        select: { id: true, name: true, room: true, schedule: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: 50,
      })
      .then((doctors) =>
        doctors.map(({ schedule, ...d }) => ({
          ...d,
          duration: readSchedule(schedule)?.duration ?? null,
        })),
      ),
    appointments: await tx.appointment.findMany({
      where: { organizationId, leadId: id },
      orderBy: [{ startsAt: "desc" }, { id: "asc" }],
      take: 50,
    }),
    followUps: await tx.followUp.findMany({
      where: { organizationId, leadId: id },
      orderBy: [{ dueAt: "desc" }, { id: "asc" }],
      take: 50,
    }),
  }));
}
async function available(
  tx: Prisma.TransactionClient,
  organizationId: string,
  leadId: string,
  data: { resource: string; startsAt: Date; endsAt: Date },
  except?: string,
) {
  await enforceDoctorSchedule(tx, organizationId, data.resource, data);
  const collision = await tx.appointment.findFirst({
    where: {
      organizationId,
      ...(except ? { id: { not: except } } : {}),
      status: { in: activeAppointments },
      startsAt: { lt: data.endsAt },
      endsAt: { gt: data.startsAt },
      OR: [{ resource: data.resource }, { leadId }],
    },
    select: { id: true },
  });
  if (collision)
    throw new ClinicError(
      "That lead or practitioner already has an overlapping appointment.",
    );
}
export async function suggestAppointments(
  userId: string,
  organizationId: string,
  leadId: string,
  input: unknown,
) {
  const query = availabilityInput.parse(input);
  return withOrganization(userId, organizationId, "read", async (tx) => {
    const now = new Date();
    if (
      query.startsAt < dayRange(clinicDate(now)).start ||
      query.endsAt.getTime() > now.getTime() + 30 * 86400000
    )
      throw new ClinicError("Search from today through the next 30 days.");
    const lead = await leadFor(tx, organizationId, leadId);
    if (lead.status === "LOST")
      throw new ClinicError("A lost lead cannot receive new appointments.");
    const doctor = await tx.doctor.findUnique({
      where: { organizationId_id: { organizationId, id: query.doctorId } },
      select: { resource: true, schedule: true },
    });
    if (!doctor) throw new AccessError();
    // Never reuse the capped agenda projection: every overlapping active booking matters.
    const busy = await tx.appointment.findMany({
      where: {
        organizationId,
        status: { in: activeAppointments },
        startsAt: { lt: query.endsAt },
        endsAt: { gt: query.startsAt },
        OR: [{ resource: doctor.resource }, { leadId }],
      },
      select: { startsAt: true, endsAt: true },
    });
    const policy = readSchedule(doctor.schedule);
    const duration = policy?.duration ?? query.duration;
    // Evaluate all bounded grid candidates before limiting: breaks/closed hours
    // must not hide later valid slots behind the first five raw candidates.
    return freeSlots(
      query,
      duration,
      busy,
      now,
      policy ? (slot) => scheduleAllows(policy, slot) : undefined,
    ).map((slot) => ({
      startsAt: slot.startsAt.toISOString(),
      endsAt: slot.endsAt.toISOString(),
      resource: doctor.resource,
    }));
  });
}
export async function bookAppointment(
  userId: string,
  organizationId: string,
  leadId: string,
  input: unknown,
) {
  const data = appointmentInput.parse(input);
  return withOrganization(userId, organizationId, "crm:write", async (tx) => {
    const lead = await leadFor(tx, organizationId, leadId);
    if (lead.status === "LOST")
      throw new ClinicError("A lost lead cannot receive new appointments.");
    future(data.startsAt);
    await available(tx, organizationId, leadId, data);
    const appointment = await tx.appointment.create({
      data: { ...data, organizationId, leadId },
    });
    await audit(
      tx,
      organizationId,
      userId,
      "clinic.appointment.booked",
      appointment.id,
    );
    return appointment;
  });
}
export async function rescheduleAppointment(
  userId: string,
  organizationId: string,
  id: string,
  input: unknown,
) {
  const data = appointmentInput.parse(input);
  return withOrganization(userId, organizationId, "crm:write", async (tx) => {
    const appointment = await tx.appointment.findUnique({
      where: { organizationId_id: { organizationId, id } },
    });
    if (!appointment) throw new AccessError();
    if (!["SCHEDULED", "CONFIRMED"].includes(appointment.status))
      throw new ClinicError(
        "Only scheduled or confirmed appointments can be rescheduled.",
      );
    if (
      await tx.queueToken.count({
        where: {
          organizationId,
          appointmentId: id,
          status: { notIn: ["COMPLETED", "CANCELLED"] },
        },
      })
    )
      throw new ClinicError(
        "Cancel the active queue token before rescheduling.",
      );
    future(data.startsAt);
    await available(tx, organizationId, appointment.leadId, data, id);
    const updated = await tx.appointment.update({
      where: { organizationId_id: { organizationId, id } },
      data,
    });
    await audit(
      tx,
      organizationId,
      userId,
      "clinic.appointment.rescheduled",
      id,
    );
    return updated;
  });
}
export async function transitionAppointment(
  userId: string,
  organizationId: string,
  id: string,
  input: unknown,
) {
  const status = appointmentStatus.parse(input);
  return withOrganization(userId, organizationId, "crm:write", async (tx) => {
    const appointment = await tx.appointment.findUnique({
      where: { organizationId_id: { organizationId, id } },
    });
    if (!appointment) throw new AccessError();
    checkAppointmentTransition(
      appointment.status,
      status,
      appointment.startsAt,
    );
    const updated = await tx.appointment.update({
      where: { organizationId_id: { organizationId, id } },
      data: { status },
    });
    await audit(
      tx,
      organizationId,
      userId,
      `clinic.appointment.${status.toLowerCase()}`,
      id,
    );
    if (["CANCELLED", "NO_SHOW", "COMPLETED"].includes(status)) {
      const token = await tx.queueToken.findFirst({
        where: {
          organizationId,
          appointmentId: id,
          status: { notIn: ["COMPLETED", "CANCELLED"] },
        },
      });
      if (token && !["COMPLETED", "CANCELLED"].includes(token.status)) {
        await tx.queueToken.update({
          where: { organizationId_id: { organizationId, id: token.id } },
          data: {
            status: status === "COMPLETED" ? "COMPLETED" : "CANCELLED",
            completedAt: status === "COMPLETED" ? new Date() : null,
          },
        });
        await tx.doctor.update({
          where: { organizationId_id: { organizationId, id: token.doctorId } },
          data: { revision: { increment: 1 } },
        });
        await audit(
          tx,
          organizationId,
          userId,
          "clinic.token.appointment_closed",
          token.id,
        );
      }
    }
    return updated;
  });
}
export async function createFollowUp(
  userId: string,
  organizationId: string,
  leadId: string,
  input: unknown,
) {
  const data = followUpInput.parse(input);
  return withOrganization(userId, organizationId, "crm:write", async (tx) => {
    await leadFor(tx, organizationId, leadId);
    future(data.dueAt);
    const followUp = await tx.followUp.create({
      data: { ...data, organizationId, leadId },
    });
    await audit(
      tx,
      organizationId,
      userId,
      "clinic.followup.created",
      followUp.id,
    );
    return followUp;
  });
}
export async function updateFollowUp(
  userId: string,
  organizationId: string,
  id: string,
  input: unknown,
) {
  const data = followUpInput.parse(input);
  return withOrganization(userId, organizationId, "crm:write", async (tx) => {
    const followUp = await tx.followUp.findUnique({
      where: { organizationId_id: { organizationId, id } },
    });
    if (!followUp) throw new AccessError();
    if (followUp.status !== "OPEN")
      throw new ClinicError("Only open follow-ups can be edited.");
    future(data.dueAt);
    const updated = await tx.followUp.update({
      where: { organizationId_id: { organizationId, id } },
      data,
    });
    await audit(tx, organizationId, userId, "clinic.followup.updated", id);
    return updated;
  });
}
export async function transitionFollowUp(
  userId: string,
  organizationId: string,
  id: string,
  input: unknown,
) {
  const status = followUpStatus.parse(input);
  return withOrganization(userId, organizationId, "crm:write", async (tx) => {
    const followUp = await tx.followUp.findUnique({
      where: { organizationId_id: { organizationId, id } },
    });
    if (!followUp) throw new AccessError();
    if (followUp.status !== "OPEN" || status === "OPEN")
      throw new ClinicError(
        "Only open follow-ups can be completed or cancelled.",
      );
    const updated = await tx.followUp.update({
      where: { organizationId_id: { organizationId, id } },
      data: { status, completedAt: status === "DONE" ? new Date() : null },
    });
    await audit(
      tx,
      organizationId,
      userId,
      `clinic.followup.${status.toLowerCase()}`,
      id,
    );
    return updated;
  });
}
export async function listAppointments(
  userId: string,
  organizationId: string,
  day = clinicDate(),
) {
  const range = dayRange(day);
  return withOrganization(userId, organizationId, "read", (tx) =>
    tx.appointment.findMany({
      where: {
        organizationId,
        startsAt: { lt: range.end },
        endsAt: { gt: range.start },
      },
      include: { lead: { select: { name: true, phone: true } } },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      take: 100,
    }),
  );
}
export async function listFollowUps(
  userId: string,
  organizationId: string,
  view = "OPEN",
) {
  const status = followUpStatus.parse(view);
  return withOrganization(userId, organizationId, "read", (tx) =>
    tx.followUp.findMany({
      where: { organizationId, status },
      include: { lead: { select: { name: true, phone: true } } },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: 100,
    }),
  );
}
export async function dashboard(userId: string, organizationId: string) {
  return withOrganization(userId, organizationId, "read", async (tx) => {
    const now = new Date(),
      range = dayRange(clinicDate(now));
    return {
      leads: await tx.clinicLead.groupBy({
        by: ["status"],
        where: { organizationId },
        _count: { _all: true },
      }),
      appointmentsToday: await tx.appointment.count({
        where: {
          organizationId,
          status: { not: "CANCELLED" },
          startsAt: { gte: range.start, lt: range.end },
        },
      }),
      overdueFollowUps: await tx.followUp.count({
        where: { organizationId, status: "OPEN", dueAt: { lt: now } },
      }),
      openFollowUps: await tx.followUp.count({
        where: { organizationId, status: "OPEN" },
      }),
      upcoming: await tx.appointment.findMany({
        where: {
          organizationId,
          status: { in: activeAppointments },
          startsAt: { gte: now },
        },
        include: { lead: { select: { name: true } } },
        orderBy: [{ startsAt: "asc" }, { id: "asc" }],
        take: 10,
      }),
    };
  });
}
