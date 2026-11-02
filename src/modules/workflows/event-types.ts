import { z } from "zod";

export const WorkflowDomainEvents = [
  "crm.opportunity.created",
  "clinic.lead.created",
  "clinic.appointment.booked",
  "clinic.queue.token_called",
  "clinic.billing.invoice_created",
  "clinic.billing.payment_settled",
] as const;

export type WorkflowDomainEventType = (typeof WorkflowDomainEvents)[number];

export const BaseEventPayloadSchema = z.object({
  organizationId: z.string().min(1),
  timestamp: z.string().optional(),
});

export const ClinicLeadCreatedPayloadSchema = BaseEventPayloadSchema.extend({
  leadId: z.string(),
  name: z.string(),
  phone: z.string(),
  treatmentInterest: z.string().optional(),
  source: z.string().optional(),
  estimatedBudget: z.number().optional(),
});

export const ClinicAppointmentBookedPayloadSchema = BaseEventPayloadSchema.extend({
  appointmentId: z.string(),
  patientName: z.string(),
  doctorName: z.string(),
  startsAt: z.string(),
  resource: z.string().optional(),
  clinicalNotes: z.string().optional(),
});

export const ClinicQueueTokenCalledPayloadSchema = BaseEventPayloadSchema.extend({
  tokenNumber: z.number(),
  patientName: z.string(),
  doctorName: z.string(),
  room: z.string(),
  calledAt: z.string().optional(),
});

export const ClinicPaymentSettledPayloadSchema = BaseEventPayloadSchema.extend({
  invoiceId: z.string(),
  paymentLinkId: z.string(),
  amountPaise: z.number().int().positive(),
  gateway: z.string(),
  transactionRef: z.string(),
  settledAt: z.string(),
});

export type ClinicLeadCreatedPayload = z.infer<typeof ClinicLeadCreatedPayloadSchema>;
export type ClinicAppointmentBookedPayload = z.infer<typeof ClinicAppointmentBookedPayloadSchema>;
export type ClinicQueueTokenCalledPayload = z.infer<typeof ClinicQueueTokenCalledPayloadSchema>;
export type ClinicPaymentSettledPayload = z.infer<typeof ClinicPaymentSettledPayloadSchema>;
