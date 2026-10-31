import { z } from "zod";
import {
  digest,
  drafts,
  fixtureArtifact,
  fixtureCommit,
  fixtureRepository,
} from "./fixtures";

export const uuid = z
  .uuid()
  .refine(
    (value) => value === value.toLowerCase(),
    "Use canonical lowercase identifiers",
  );
export const department = z.enum(["ENGINEERING", "OPERATIONS"]);
export const scope = z.strictObject({
  kind: z.literal("bbd-internal-only"),
  companyId: uuid,
});
export const taskRequest = z
  .strictObject({
    schema: z.literal("bbd.workforce.draft.requested.v1"),
    taskId: uuid,
    correlationId: uuid,
    scope,
    department,
    taskKind: z.enum(["review-summary", "readiness-checklist"]),
    source: z.strictObject({
      kind: z.literal("synthetic-repository-metadata"),
      repository: z.literal(fixtureRepository),
      commit: z.literal(fixtureCommit),
    }),
    inputArtifact: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    outputKind: z.literal("markdown-draft"),
    approvalState: z.literal("PENDING"),
    executionStatus: z.literal("QUEUED"),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    limits: z.strictObject({
      maxAttempts: z.number().int().min(1).max(3),
      maxRunSeconds: z.number().int().min(1).max(300),
      maxSpendUsdCents: z.literal(0),
    }),
  })
  .superRefine((request, context) => {
    const kind =
      request.department === "ENGINEERING"
        ? "review-summary"
        : "readiness-checklist";
    if (
      request.taskKind !== kind ||
      request.inputArtifact !== fixtureArtifact(request.department)
    )
      context.addIssue({
        code: "custom",
        message: "Only the matching synthetic fixture is permitted",
      });
    const duration =
      Date.parse(request.expiresAt) - Date.parse(request.createdAt);
    if (duration <= 0 || duration > 900000)
      context.addIssue({
        code: "custom",
        message: "Approval window must be positive and at most fifteen minutes",
      });
  });
export type TaskRequest = z.infer<typeof taskRequest>;
export const fingerprint = (request: TaskRequest) =>
  digest(JSON.stringify(taskRequest.parse(request)));
export const command = z.strictObject({
  expectedVersion: z.number().int().min(0).max(10000),
  requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export const taskResult = z.strictObject({
  schema: z.literal("bbd.workforce.draft.result.v1"),
  taskId: uuid,
  correlationId: uuid,
  scope,
  department,
  sourceCommit: z.literal(fixtureCommit),
  requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  approvalId: uuid,
  approvalState: z.literal("APPROVED"),
  executionStatus: z.literal("DRAFT_READY"),
  attempt: z.number().int().min(1).max(3),
  mock: z.literal(true),
  requiresHumanReview: z.literal(true),
  artifact: z.strictObject({
    kind: z.literal("markdown-draft"),
    content: z.enum([drafts.ENGINEERING, drafts.OPERATIONS]),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
});
export type TaskResult = z.infer<typeof taskResult>;

export function validateResult(
  input: unknown,
  request: TaskRequest,
  approvalId: string,
  attempt: number,
): TaskResult {
  const result = taskResult.parse(input);
  if (
    result.taskId !== request.taskId ||
    result.correlationId !== request.correlationId ||
    result.scope.companyId !== request.scope.companyId ||
    result.department !== request.department ||
    result.requestDigest !== fingerprint(request) ||
    result.approvalId !== approvalId ||
    result.attempt !== attempt ||
    result.artifact.content !== drafts[request.department] ||
    result.artifact.digest !== digest(result.artifact.content)
  )
    throw new Error("Invalid workforce result binding");
  return result;
}
