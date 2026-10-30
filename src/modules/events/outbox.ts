import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { moduleAccess } from "@/modules/entitlements/access";
import {
  batchInput,
  eventEnvelope,
  eventType,
  schemaVersion,
  opportunityPayload,
  type EventBatch,
} from "./contract";

// Trusted producer only: call inside the existing authorized, exclusive
// organization transaction. Never open a second/global DB connection here.
// The exclusive org write lock makes max+1 commit-ordered for compliant producers;
// timestamps/UUIDs are NOT cursors. Constraints reject duplicate identities.
export async function appendOpportunityCreated(
  tx: Prisma.TransactionClient,
  organizationId: string,
  opportunityId: string,
) {
  const payload = opportunityPayload.parse({ opportunityId });
  const maximum = await tx.outboxEvent.aggregate({
    where: { organizationId },
    _max: { sequence: true },
  });
  return tx.outboxEvent.create({
    data: {
      id: randomUUID(),
      organizationId,
      opportunityId,
      eventType,
      schemaVersion,
      sequence: (maximum._max.sequence ?? 0n) + 1n,
      payload,
    },
  });
}

// Internal bounded pull interface, not an HTTP endpoint or running dispatcher.
// Actor comes from trusted server context. No payload, SQL or transaction
// callback is accepted. Consumers must validate/re-authorize before side effects.
export async function readEventBatch(
  actor: string,
  organizationId: string,
  input: unknown = {},
): Promise<EventBatch> {
  const query = batchInput.parse(input);
  return moduleAccess("crm")(
    actor,
    organizationId,
    "events:read",
    async (tx) => {
      const rows = await tx.outboxEvent.findMany({
        where: { organizationId, sequence: { gt: BigInt(query.after) } },
        orderBy: { sequence: "asc" },
        take: query.limit,
      });
      const events = rows.map((row) =>
        eventEnvelope.parse({
          id: row.id,
          organizationId: row.organizationId,
          sequence: row.sequence.toString(),
          eventType: row.eventType,
          schemaVersion: row.schemaVersion,
          occurredAt: row.occurredAt.toISOString(),
          payload: row.payload,
        }),
      );
      return { events, nextAfter: events.at(-1)?.sequence ?? query.after };
    },
  );
}
