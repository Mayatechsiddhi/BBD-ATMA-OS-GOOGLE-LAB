import type { Prisma, QueueStatus } from "@/generated/prisma/client";
import { audit } from "@/modules/organizations/access";
import { moduleAccess } from "@/modules/entitlements/access";
const withOrganization = moduleAccess("clinic");
import { AccessError } from "@/modules/organizations/policy";
import { leadInput } from "@/modules/clinic/validation";
import { clinicDate, dayRange } from "@/modules/clinic/time";
import {
  checkAppointmentTransition,
  ClinicError,
} from "@/modules/clinic/workflow";
import {
  doctorInput,
  queueAction,
  queueQuery,
  queueTransitions,
} from "./validation";
export type Board = {
  day: string;
  revision: string;
  doctors: {
    id: string;
    name: string;
    room: string;
    current: { number: number; callCount: number } | null;
    next: number[];
  }[];
};
async function patientFor(
  tx: Prisma.TransactionClient,
  org: string,
  leadId: string,
  actor: string,
) {
  const lead = await tx.clinicLead.findUnique({
    where: { organizationId_id: { organizationId: org, id: leadId } },
  });
  if (!lead) throw new AccessError();
  let patient = await tx.patient.findUnique({
    where: { organizationId_leadId: { organizationId: org, leadId } },
  });
  if (!patient) {
    patient = await tx.patient.create({
      data: { organizationId: org, leadId },
    });
    await audit(tx, org, actor, "clinic.patient.registered", patient.id);
  }
  return patient;
}
export async function registerPatient(
  actor: string,
  org: string,
  input: unknown,
) {
  const data = leadInput.parse(input);
  return withOrganization(actor, org, "crm:write", async (tx) => {
    const lead = await tx.clinicLead.create({
      data: { ...data, organizationId: org },
    });
    await audit(tx, org, actor, "clinic.lead.created", lead.id);
    return patientFor(tx, org, lead.id, actor);
  });
}
export async function registerLead(actor: string, org: string, leadId: string) {
  return withOrganization(actor, org, "crm:write", (tx) =>
    patientFor(tx, org, leadId, actor),
  );
}
export async function createDoctor(actor: string, org: string, input: unknown) {
  const data = doctorInput.parse(input);
  return withOrganization(actor, org, "crm:write", async (tx) => {
    if ((await tx.doctor.count({ where: { organizationId: org } })) >= 50)
      throw new ClinicError("This milestone supports up to 50 doctor queues.");
    const doctor = await tx.doctor.create({
      data: { ...data, organizationId: org },
    });
    await audit(tx, org, actor, "clinic.doctor.created", doctor.id);
    return doctor;
  });
}
export async function updateDoctor(
  actor: string,
  org: string,
  id: string,
  input: unknown,
) {
  const data = doctorInput.pick({ name: true, room: true }).parse(input);
  return withOrganization(actor, org, "crm:write", async (tx) => {
    const doctor = await tx.doctor.findUnique({
      where: { organizationId_id: { organizationId: org, id } },
    });
    if (!doctor) throw new AccessError();
    const updated = await tx.doctor.update({
      where: { organizationId_id: { organizationId: org, id } },
      data: { ...data, revision: { increment: 1 } },
    });
    await audit(tx, org, actor, "clinic.doctor.updated", id);
    return updated;
  });
}
export async function issueToken(
  actor: string,
  org: string,
  input: { doctorId: string; patientId?: string; appointmentId?: string },
) {
  return withOrganization(actor, org, "crm:write", async (tx) => {
    const doctor = await tx.doctor.findUnique({
      where: { organizationId_id: { organizationId: org, id: input.doctorId } },
    });
    if (!doctor) throw new AccessError();
    let patient;
    if (input.appointmentId) {
      const appointment = await tx.appointment.findUnique({
        where: {
          organizationId_id: { organizationId: org, id: input.appointmentId },
        },
      });
      if (!appointment) throw new AccessError();
      if (
        clinicDate(appointment.startsAt) !== clinicDate() ||
        !["SCHEDULED", "CONFIRMED", "CHECKED_IN"].includes(appointment.status)
      )
        throw new ClinicError(
          "Only today's active appointments can receive tokens.",
        );
      if (appointment.resource !== doctor.resource)
        throw new ClinicError(
          "Choose the doctor matching the appointment resource.",
        );
      patient = await patientFor(tx, org, appointment.leadId, actor);
    } else {
      patient = await tx.patient.findUnique({
        where: {
          organizationId_id: { organizationId: org, id: input.patientId ?? "" },
        },
      });
      if (!patient) throw new AccessError();
    }
    const day = clinicDate();
    const lead = await tx.clinicLead.findUniqueOrThrow({
      where: { organizationId_id: { organizationId: org, id: patient.leadId } },
    });
    if (lead.status === "LOST")
      throw new ClinicError("Closed lost leads cannot receive tokens.");
    if (
      await tx.queueToken.findFirst({
        where: {
          organizationId: org,
          day,
          doctorId: doctor.id,
          patientId: patient.id,
          status: { not: "CANCELLED" },
        },
      })
    )
      throw new ClinicError(
        "This patient already has a token for this doctor today.",
      );
    if (
      input.appointmentId &&
      (await tx.queueToken.findFirst({
        where: {
          organizationId: org,
          appointmentId: input.appointmentId,
          status: { not: "CANCELLED" },
        },
      }))
    )
      throw new ClinicError("This appointment already has a token.");
    const last = await tx.queueToken.aggregate({
      where: { organizationId: org, day },
      _max: { number: true },
    });
    const number = (last._max.number ?? 0) + 1;
    if (number > 99999) throw new ClinicError("Daily token limit reached.");
    const token = await tx.queueToken.create({
      data: {
        organizationId: org,
        doctorId: doctor.id,
        patientId: patient.id,
        leadId: patient.leadId,
        appointmentId: input.appointmentId,
        day,
        number,
      },
    });
    await tx.doctor.update({
      where: { organizationId_id: { organizationId: org, id: doctor.id } },
      data: { revision: { increment: 1 } },
    });
    await audit(tx, org, actor, "clinic.token.issued", token.id);
    return token;
  });
}
export async function actOnToken(
  actor: string,
  org: string,
  id: string,
  input: unknown,
) {
  const action = queueAction.parse(input);
  return withOrganization(actor, org, "crm:write", async (tx) => {
    const token = await tx.queueToken.findUnique({
      where: { organizationId_id: { organizationId: org, id } },
    });
    if (!token) throw new AccessError();
    if (token.day !== clinicDate() && ["CALL", "RECALL"].includes(action))
      throw new ClinicError("Calls are limited to today’s tokens.");
    if (!(queueTransitions[token.status] as readonly string[]).includes(action))
      throw new ClinicError("That token action is not allowed.");
    if (
      action === "CALL" &&
      (await tx.queueToken.count({
        where: {
          organizationId: org,
          doctorId: token.doctorId,
          day: token.day,
          status: "CALLED",
        },
      }))
    )
      throw new ClinicError("Complete or skip the current call first.");
    if (
      token.appointmentId &&
      ["CALL", "RECALL", "COMPLETE"].includes(action)
    ) {
      const appointment = await tx.appointment.findUniqueOrThrow({
        where: {
          organizationId_id: { organizationId: org, id: token.appointmentId },
        },
      });
      if (
        !["SCHEDULED", "CONFIRMED", "CHECKED_IN"].includes(appointment.status)
      )
        throw new ClinicError("This appointment is no longer active.");
      if (appointment.status !== "CHECKED_IN") {
        checkAppointmentTransition(
          appointment.status,
          "CHECKED_IN",
          appointment.startsAt,
        );
        await tx.appointment.update({
          where: {
            organizationId_id: { organizationId: org, id: appointment.id },
          },
          data: { status: "CHECKED_IN" },
        });
        await audit(
          tx,
          org,
          actor,
          "clinic.appointment.checked_in",
          appointment.id,
        );
      }
      if (action === "COMPLETE") {
        await tx.appointment.update({
          where: {
            organizationId_id: { organizationId: org, id: appointment.id },
          },
          data: { status: "COMPLETED" },
        });
        await audit(
          tx,
          org,
          actor,
          "clinic.appointment.completed",
          appointment.id,
        );
      }
    }
    const status: QueueStatus = (
      {
        CALL: "CALLED",
        RECALL: "CALLED",
        SKIP: "SKIPPED",
        COMPLETE: "COMPLETED",
        CANCEL: "CANCELLED",
      } as const
    )[action];
    const updated = await tx.queueToken.update({
      where: { organizationId_id: { organizationId: org, id } },
      data: {
        status,
        ...(["CALL", "RECALL"].includes(action)
          ? { callCount: { increment: 1 }, calledAt: new Date() }
          : {}),
        ...(action === "COMPLETE" ? { completedAt: new Date() } : {}),
      },
    });
    await tx.doctor.update({
      where: { organizationId_id: { organizationId: org, id: token.doctorId } },
      data: { revision: { increment: 1 } },
    });
    await audit(tx, org, actor, `clinic.token.${action.toLowerCase()}`, id);
    return updated;
  });
}
export async function board(
  actor: string,
  org: string,
  permission: "read" | "display:read" = "display:read",
): Promise<Board> {
  return withOrganization(actor, org, permission, async (tx, role) => {
    const day = clinicDate();
    const doctors = await tx.doctor.findMany({
      where: { organizationId: org },
      orderBy: { id: "asc" },
      select: {
        id: true,
        name: true,
        room: true,
        revision: true,
        updatedAt: true,
      },
    });
    const tokens = await tx.$queryRaw<
      { doctorId: string; number: number; callCount: number; status: string }[]
    >`
      SELECT "doctorId",number,"callCount",status::text FROM (
        SELECT "doctorId",number,"callCount",status,row_number() OVER (PARTITION BY "doctorId",status ORDER BY number) AS position
        FROM public."QueueToken" WHERE "organizationId"=${org} AND day=${day} AND status IN ('CALLED','WAITING')
      ) ranked WHERE position<=3`;
    const data = doctors.map((d) => {
      const current = tokens.find(
        (t) => t.doctorId === d.id && t.status === "CALLED",
      );
      return {
        id: d.id,
        name: d.name,
        room: d.room,
        current: current
          ? { number: current.number, callCount: current.callCount }
          : null,
        next: tokens
          .filter((t) => t.doctorId === d.id && t.status === "WAITING")
          .sort((a, b) => a.number - b.number)
          .map((t) => t.number),
      };
    });
    return {
      day,
      revision:
        day +
        doctors
          .map((d) => `${d.id}:${d.revision}:${d.updatedAt.toISOString()}`)
          .join("|") +
        (permission === "read" ? `|${role}` : ""),
      doctors: data,
    };
  });
}
export async function reception(
  actor: string,
  org: string,
  input: unknown = {},
) {
  const query = queueQuery.parse(input);
  const range = dayRange(clinicDate());
  return withOrganization(actor, org, "read", async (tx) => {
    const patientsWhere = {
      organizationId: org,
      ...(query.search
        ? {
            lead: {
              OR: [
                {
                  name: {
                    contains: query.search,
                    mode: "insensitive" as const,
                  },
                },
                { phone: { contains: query.search } },
              ],
            },
          }
        : {}),
    };
    const where = {
      organizationId: org,
      day: query.day,
      ...(query.doctorId ? { doctorId: query.doctorId } : {}),
    };
    return {
      query,
      doctors: await tx.doctor.findMany({
        where: { organizationId: org },
        orderBy: { name: "asc" },
      }),
      patients: await tx.patient.findMany({
        where: patientsWhere,
        include: { lead: { select: { name: true, phone: true } } },
        orderBy: { id: "asc" },
        skip: (query.patientPage - 1) * 25,
        take: 25,
      }),
      totalPatients: await tx.patient.count({ where: patientsWhere }),
      total: await tx.queueToken.count({ where }),
      tokens: await tx.queueToken.findMany({
        where,
        include: {
          patient: {
            include: { lead: { select: { name: true, phone: true } } },
          },
          doctor: true,
        },
        orderBy: { number: "asc" },
        skip: (query.page - 1) * 50,
        take: 50,
      }),
      appointments: await tx.appointment.findMany({
        where: {
          organizationId: org,
          startsAt: { gte: range.start, lt: range.end },
          status: { in: ["SCHEDULED", "CONFIRMED", "CHECKED_IN"] },
          queueTokens: { none: { status: { not: "CANCELLED" } } },
        },
        include: { lead: { select: { name: true } } },
        orderBy: { startsAt: "asc" },
        take: 100,
      }),
    };
  });
}
