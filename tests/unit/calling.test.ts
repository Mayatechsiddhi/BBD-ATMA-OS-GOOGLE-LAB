import { describe, it, expect } from "vitest";
import {
  doctorInput,
  queueQuery,
  queueAction,
  queueTransitions,
} from "../../src/modules/calling/validation";
describe("calling validation and lifecycle", () => {
  it("normalizes immutable resource keys and bounds display labels", () => {
    expect(
      doctorInput.parse({
        name: " Dr Synthetic ",
        room: " 01 ",
        resource: " DR  SYNTHETIC ",
      }),
    ).toEqual({ name: "Dr Synthetic", room: "01", resource: "dr synthetic" });
    for (const change of [
      { name: "x" },
      { room: "" },
      { resource: "x" },
      { room: "x".repeat(41) },
    ])
      expect(
        doctorInput.safeParse({
          name: "Synthetic",
          room: "1",
          resource: "synthetic",
          ...change,
        }).success,
      ).toBe(false);
  });
  it("bounds reception paging and rejects arbitrary actions", () => {
    expect(queueQuery.parse({}).page).toBe(1);
    expect(queueQuery.safeParse({ page: 0 }).success).toBe(false);
    expect(queueQuery.safeParse({ patientPage: -1 }).success).toBe(false);
    expect(queueQuery.safeParse({ search: "x".repeat(101) }).success).toBe(
      false,
    );
    expect(queueAction.safeParse("DELETE").success).toBe(false);
  });
  it("closes terminal tokens and restricts recall/completion to called tokens", () => {
    expect(queueTransitions.COMPLETED).toEqual([]);
    expect(queueTransitions.CANCELLED).toEqual([]);
    expect(queueTransitions.WAITING).not.toContain("COMPLETE");
    expect(queueTransitions.SKIPPED).not.toContain("RECALL");
    expect(queueTransitions.CALLED).toEqual([
      "RECALL",
      "SKIP",
      "COMPLETE",
      "CANCEL",
    ]);
  });
});
