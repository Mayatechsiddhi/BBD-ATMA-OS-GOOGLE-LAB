import { describe, expect, it } from "vitest";
import {
  batchInput,
  eventEnvelope,
  opportunityPayload,
} from "../../src/modules/events/contract";

describe("event v1 contract", () => {
  it("bounds batches and validates exact bigint cursors without numeric precision loss", () => {
    expect(batchInput.parse({})).toEqual({ after: "0", limit: 25 });
    expect(
      batchInput.parse({ after: "9223372036854775807", limit: 50 }).after,
    ).toBe("9223372036854775807");
    for (const input of [
      { after: "-1" },
      { after: "01" },
      { after: "1.0" },
      { after: "9223372036854775808" },
      { after: 1 },
      { limit: 0 },
      { limit: 51 },
      { limit: 1.5 },
      { organizationId: "foreign" },
      { sql: "SELECT 1" },
    ])
      expect(() => batchInput.parse(input)).toThrow();
  });
  it("permits only an opaque opportunity reference; rejects names, credentials and arbitrary JSON", () => {
    expect(
      opportunityPayload.parse({ opportunityId: "opportunity-1" }),
    ).toEqual({ opportunityId: "opportunity-1" });
    for (const payload of [
      null,
      [],
      {},
      { opportunityId: "x", email: "synthetic@example.com" },
      { opportunityId: "x", token: "secret" },
      { opportunityId: "x".repeat(101) },
    ])
      expect(() => opportunityPayload.parse(payload)).toThrow();
  });
  it("serializes only the supported envelope and rejects unknown types/versions before cursor advancement", () => {
    const event = {
      id: "c85b5bb0-5180-4d86-a4db-d1d00ff7317b",
      organizationId: "org-a",
      sequence: "9007199254740993",
      eventType: "crm.opportunity.created",
      schemaVersion: 1,
      occurredAt: "2026-10-31T00:00:00.000Z",
      payload: { opportunityId: "opportunity-1" },
    };
    expect(eventEnvelope.parse(event)).toEqual(event);
    expect(() => JSON.stringify(eventEnvelope.parse(event))).not.toThrow();
    for (const patch of [
      { eventType: "arbitrary.action" },
      { schemaVersion: 2 },
      { sequence: "0" },
      { sequence: 1 },
      { token: "secret" },
    ])
      expect(() => eventEnvelope.parse({ ...event, ...patch })).toThrow();
  });
});
