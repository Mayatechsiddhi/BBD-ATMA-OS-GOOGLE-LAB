import { randomUUID } from "node:crypto";
import {
  fixtureArtifact,
  fixtureCommit,
  fixtureRepository,
} from "../../src/modules/internal-workforce/fixtures";
import type { TaskRequest } from "../../src/modules/internal-workforce/contract";
import { createMockWorkforceHarness } from "../../src/modules/internal-workforce/harness";

export const company = "00000000-0000-4000-8000-000000000001";
export const actors = {
  requester: "00000000-0000-4000-8000-000000000011",
  otherRequester: "00000000-0000-4000-8000-000000000012",
  approver: "00000000-0000-4000-8000-000000000021",
  operator: "00000000-0000-4000-8000-000000000031",
  engineer: "00000000-0000-4000-8000-000000000032",
  engineeringApprover: "00000000-0000-4000-8000-000000000022",
};
export function policy(companyId = company) {
  return {
    companyId,
    principals: [
      {
        actorId: actors.requester,
        companyId,
        role: "REQUESTER",
        departments: ["ENGINEERING", "OPERATIONS"],
      },
      {
        actorId: actors.otherRequester,
        companyId,
        role: "REQUESTER",
        departments: ["ENGINEERING", "OPERATIONS"],
      },
      {
        actorId: actors.approver,
        companyId,
        role: "APPROVER",
        departments: ["ENGINEERING", "OPERATIONS"],
      },
      {
        actorId: actors.operator,
        companyId,
        role: "OPERATOR",
        departments: ["ENGINEERING", "OPERATIONS"],
      },
      {
        actorId: actors.engineer,
        companyId,
        role: "OPERATOR",
        departments: ["ENGINEERING"],
      },
      {
        actorId: actors.engineeringApprover,
        companyId,
        role: "APPROVER",
        departments: ["ENGINEERING"],
      },
    ],
    maxTasks: 64,
    maxAudit: 512,
    mockPlan: {
      ENGINEERING: { transientFailures: 0, permanentFailure: false },
      OPERATIONS: { transientFailures: 0, permanentFailure: false },
    },
  };
}
export function request(
  department: TaskRequest["department"] = "ENGINEERING",
  companyId = company,
): TaskRequest {
  return {
    schema: "bbd.workforce.draft.requested.v1",
    taskId: randomUUID(),
    correlationId: randomUUID(),
    scope: { kind: "bbd-internal-only", companyId },
    department,
    taskKind:
      department === "ENGINEERING" ? "review-summary" : "readiness-checklist",
    source: {
      kind: "synthetic-repository-metadata",
      repository: fixtureRepository,
      commit: fixtureCommit,
    },
    inputArtifact: fixtureArtifact(department),
    outputKind: "markdown-draft",
    approvalState: "PENDING",
    executionStatus: "QUEUED",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    limits: { maxAttempts: 2, maxRunSeconds: 300, maxSpendUsdCents: 0 },
  };
}
export const commandFor = (record: {
  version: number;
  requestDigest: string;
}) => ({
  expectedVersion: record.version,
  requestDigest: record.requestDigest,
});
export const harness = () => createMockWorkforceHarness(policy());
