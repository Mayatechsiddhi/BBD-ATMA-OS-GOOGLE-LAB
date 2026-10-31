import { digest, drafts, fixtureCommit } from "./fixtures";
import { fingerprint, validateResult, type TaskRequest } from "./contract";

// No injected executor, handler, transport or payload interpreter. Failures are
// trusted harness-test configuration; no agent or request can set them.
export type MockPlan = { transientFailures: number; permanentFailure: boolean };
export function mockAttempt(
  request: TaskRequest,
  approvalId: string,
  attempt: number,
  plan: MockPlan,
) {
  if (plan.permanentFailure) return { kind: "PERMANENT_FAILURE" } as const;
  if (attempt <= plan.transientFailures)
    return { kind: "TRANSIENT_FAILURE" } as const;
  const content = drafts[request.department];
  return {
    kind: "SUCCESS",
    result: validateResult(
      {
        schema: "bbd.workforce.draft.result.v1",
        taskId: request.taskId,
        correlationId: request.correlationId,
        scope: request.scope,
        department: request.department,
        sourceCommit: fixtureCommit,
        requestDigest: fingerprint(request),
        approvalId,
        approvalState: "APPROVED",
        executionStatus: "DRAFT_READY",
        attempt,
        mock: true,
        requiresHumanReview: true,
        artifact: { kind: "markdown-draft", content, digest: digest(content) },
      },
      request,
      approvalId,
      attempt,
    ),
  } as const;
}
