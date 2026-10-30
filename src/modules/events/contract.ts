import { z } from "zod";

export const eventType = "crm.opportunity.created" as const;
export const schemaVersion = 1 as const;
export const opportunityPayload = z.strictObject({
  opportunityId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
});
export const batchInput = z.strictObject({
  after: z
    .string()
    .regex(/^(0|[1-9][0-9]{0,18})$/)
    .refine((value) => BigInt(value) <= 9223372036854775807n)
    .default("0"),
  limit: z.number().int().min(1).max(50).default(25),
});
export const eventEnvelope = z.strictObject({
  id: z.uuid(),
  organizationId: z.string().min(1).max(100),
  sequence: z
    .string()
    .regex(/^[1-9][0-9]{0,18}$/)
    .refine((value) => BigInt(value) <= 9223372036854775807n),
  eventType: z.literal(eventType),
  schemaVersion: z.literal(schemaVersion),
  occurredAt: z.iso.datetime(),
  payload: opportunityPayload,
});
export type EventEnvelope = z.infer<typeof eventEnvelope>;
export type EventBatch = { events: EventEnvelope[]; nextAfter: string };
