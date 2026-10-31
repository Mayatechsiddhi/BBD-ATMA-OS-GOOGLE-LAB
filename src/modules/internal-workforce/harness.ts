import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  command,
  department,
  uuid,
  fingerprint,
  taskRequest,
  validateResult,
  type TaskRequest,
  type TaskResult,
} from "./contract";
import { mockAttempt } from "./mock-adapter";

const role = z.enum(["REQUESTER", "APPROVER", "OPERATOR"]);
const principal = z.strictObject({
  actorId: uuid,
  companyId: uuid,
  role,
  departments: z.array(department).min(1).max(2),
});
const plan = z.strictObject({
  transientFailures: z.number().int().min(0).max(3),
  permanentFailure: z.boolean(),
});
const config = z.strictObject({
  companyId: uuid,
  principals: z.array(principal).min(1).max(20),
  maxTasks: z.number().int().min(1).max(64).default(64),
  maxAudit: z.number().int().min(2).max(512).default(512),
  mockPlan: z.strictObject({ ENGINEERING: plan, OPERATIONS: plan }),
});
type Role = z.infer<typeof role>;
type Status =
  | "QUEUED"
  | "RUNNING"
  | "RETRYABLE_FAILURE"
  | "DRAFT_READY"
  | "FAILED"
  | "CANCELLED";
type Approval = "PENDING" | "APPROVED" | "REVOKED" | "REJECTED";
type Record = {
  request: TaskRequest;
  submittedBy: string;
  requestDigest: string;
  version: number;
  approvalState: Approval;
  approvalId?: string;
  approvedBy?: string;
  executionStatus: Status;
  attempts: number;
  result?: TaskResult;
};
type Audit = {
  sequence: number;
  schema: "bbd.workforce.audit.v1";
  companyId: string;
  actorId: string;
  action: string;
  taskId: string | null;
  correlationId: string | null;
  requestDigest: string | null;
  department: z.infer<typeof department> | null;
  executionStatus: Status | null;
  approvalState: Approval | null;
  attempt: number;
  occurredAt: string;
};
export class WorkforceError extends Error {
  constructor(
    public readonly code:
      | "ACCESS_DENIED"
      | "CONFLICT"
      | "INVALID_TRANSITION"
      | "APPROVAL_REQUIRED"
      | "EXPIRED"
      | "PAUSED"
      | "ATTEMPTS_EXHAUSTED"
      | "ALREADY_EXECUTED"
      | "CAPACITY",
  ) {
    super(code);
  }
}
const permissions: { [R in Role]: readonly string[] } = {
  REQUESTER: ["submit", "read"],
  APPROVER: ["approve", "revoke", "reject", "pause", "read", "audit"],
  OPERATOR: ["execute", "retry", "read"],
};

/** Isolated process-local test harness, not production authentication, queue,
 * audit persistence or a customer-facing service. Never import in src/app. */
export function createMockWorkforceHarness(input: unknown) {
  const policy = config.parse(input);
  const principals = new Map(
    policy.principals.map((actor) => [actor.actorId, actor]),
  );
  if (
    principals.size !== policy.principals.length ||
    policy.principals.some((actor) => actor.companyId !== policy.companyId)
  )
    throw new Error("Invalid harness principal configuration");
  const records = new Map<string, Record>();
  const correlations = new Set<string>();
  const audit: Audit[] = [];
  let paused = false;
  const fail = (
    code: ConstructorParameters<typeof WorkforceError>[0],
  ): never => {
    throw new WorkforceError(code);
  };
  function authorize(actorId: string, action: string) {
    const actor = principals.get(actorId);
    if (!actor || !permissions[actor.role].includes(action))
      return fail("ACCESS_DENIED");
    return actor;
  }
  function get(actorId: string, taskId: string, action: string) {
    const actor = authorize(actorId, action);
    const record = records.get(taskId);
    if (
      !record ||
      record.request.scope.companyId !== actor.companyId ||
      !actor.departments.includes(record.request.department) ||
      (actor.role === "REQUESTER" && record.submittedBy !== actorId)
    )
      return fail("ACCESS_DENIED");
    return record;
  }
  function reserve(slots: number) {
    if (audit.length + slots > policy.maxAudit) fail("CAPACITY");
  }
  function append(actorId: string, action: string, record?: Record) {
    audit.push({
      schema: "bbd.workforce.audit.v1",
      sequence: audit.length + 1,
      companyId: policy.companyId,
      actorId,
      action,
      taskId: record?.request.taskId ?? null,
      correlationId: record?.request.correlationId ?? null,
      requestDigest: record?.requestDigest ?? null,
      department: record?.request.department ?? null,
      executionStatus: record?.executionStatus ?? null,
      approvalState: record?.approvalState ?? null,
      attempt: record?.attempts ?? 0,
      occurredAt: new Date().toISOString(),
    });
  }
  function guard(record: Record, input: unknown) {
    const data = command.parse(input);
    if (
      record.version !== data.expectedVersion ||
      record.requestDigest !== data.requestDigest
    )
      fail("CONFLICT");
  }
  function active(record: Record) {
    if (paused) fail("PAUSED");
    if (
      Date.parse(record.request.createdAt) > Date.now() ||
      Date.parse(record.request.expiresAt) <= Date.now()
    )
      fail("EXPIRED");
  }
  function approved(record: Record) {
    active(record);
    if (fingerprint(record.request) !== record.requestDigest) fail("CONFLICT");
    if (record.approvalState !== "APPROVED" || !record.approvalId)
      fail("APPROVAL_REQUIRED");
  }
  return {
    submit(actorId: string, input: unknown) {
      const actor = authorize(actorId, "submit");
      const request = taskRequest.parse(input);
      if (
        request.scope.companyId !== policy.companyId ||
        !actor.departments.includes(request.department)
      )
        return fail("ACCESS_DENIED");
      const requestDigest = fingerprint(request);
      const previous = records.get(request.taskId);
      if (previous) {
        if (
          previous.submittedBy !== actorId ||
          previous.requestDigest !== requestDigest
        )
          return fail("CONFLICT");
        return structuredClone(previous);
      }
      const record: Record = {
        request,
        submittedBy: actorId,
        requestDigest,
        version: 0,
        approvalState: "PENDING",
        executionStatus: "QUEUED",
        attempts: 0,
      };
      active(record);
      const correlation = `${request.correlationId}:${request.department}:${request.taskKind}`;
      if (correlations.has(correlation)) return fail("CONFLICT");
      if (records.size >= policy.maxTasks) return fail("CAPACITY");
      reserve(1);
      records.set(request.taskId, record);
      correlations.add(correlation);
      append(actorId, "task.submitted", record);
      return structuredClone(record);
    },
    approve(actorId: string, taskId: string, input: unknown) {
      const record = get(actorId, taskId, "approve");
      guard(record, input);
      active(record);
      if (actorId === record.submittedBy) return fail("ACCESS_DENIED");
      if (
        record.approvalState !== "PENDING" ||
        record.executionStatus !== "QUEUED"
      )
        return fail("INVALID_TRANSITION");
      reserve(1);
      record.approvalState = "APPROVED";
      record.approvalId = randomUUID();
      record.approvedBy = actorId;
      record.version++;
      append(actorId, "task.approved", record);
      return structuredClone(record);
    },
    reject(actorId: string, taskId: string, input: unknown) {
      const record = get(actorId, taskId, "reject");
      guard(record, input);
      if (record.approvalState !== "PENDING") return fail("INVALID_TRANSITION");
      reserve(1);
      record.approvalState = "REJECTED";
      record.executionStatus = "CANCELLED";
      record.version++;
      append(actorId, "task.rejected", record);
      return structuredClone(record);
    },
    revoke(actorId: string, taskId: string, input: unknown) {
      const record = get(actorId, taskId, "revoke");
      guard(record, input);
      if (record.approvalState !== "APPROVED")
        return fail("INVALID_TRANSITION");
      reserve(1);
      record.approvalState = "REVOKED";
      record.executionStatus = "CANCELLED";
      delete record.result;
      record.version++;
      append(actorId, "task.revoked", record);
      return structuredClone(record);
    },
    execute(actorId: string, taskId: string, input: unknown) {
      const record = get(actorId, taskId, "execute");
      if (record.executionStatus === "DRAFT_READY")
        return fail("ALREADY_EXECUTED");
      guard(record, input);
      approved(record);
      if (record.executionStatus !== "QUEUED")
        return fail("INVALID_TRANSITION");
      if (record.attempts >= record.request.limits.maxAttempts)
        return fail("ATTEMPTS_EXHAUSTED");
      reserve(2);
      record.executionStatus = "RUNNING";
      record.attempts++;
      record.version++;
      append(actorId, "task.started", record);
      const started = Date.now();
      let outcome: ReturnType<typeof mockAttempt>;
      try {
        outcome = mockAttempt(
          record.request,
          record.approvalId!,
          record.attempts,
          policy.mockPlan[record.request.department],
        );
      } catch {
        outcome = { kind: "PERMANENT_FAILURE" };
      }
      if (Date.now() - started > record.request.limits.maxRunSeconds * 1000)
        record.executionStatus = "FAILED";
      else if (outcome.kind === "SUCCESS") {
        try {
          record.result = validateResult(
            outcome.result,
            record.request,
            record.approvalId!,
            record.attempts,
          );
          record.executionStatus = "DRAFT_READY";
        } catch {
          record.executionStatus = "FAILED";
        }
      } else
        record.executionStatus =
          outcome.kind === "TRANSIENT_FAILURE" &&
          record.attempts < record.request.limits.maxAttempts
            ? "RETRYABLE_FAILURE"
            : "FAILED";
      record.version++;
      append(actorId, `task.${record.executionStatus.toLowerCase()}`, record);
      return structuredClone(record);
    },
    retry(actorId: string, taskId: string, input: unknown) {
      const record = get(actorId, taskId, "retry");
      guard(record, input);
      approved(record);
      if (record.executionStatus !== "RETRYABLE_FAILURE")
        return fail("INVALID_TRANSITION");
      if (record.attempts >= record.request.limits.maxAttempts)
        return fail("ATTEMPTS_EXHAUSTED");
      reserve(1);
      record.executionStatus = "QUEUED";
      record.version++;
      append(actorId, "task.retry_requested", record);
      return structuredClone(record);
    },
    setPaused(actorId: string, value: unknown) {
      authorize(actorId, "pause");
      const next = z.boolean().parse(value);
      if (next === paused) return;
      reserve(1);
      paused = next;
      append(actorId, next ? "harness.paused" : "harness.resumed");
    },
    read(actorId: string, taskId: string) {
      return structuredClone(get(actorId, taskId, "read"));
    },
    readAudit(actorId: string) {
      const actor = authorize(actorId, "audit");
      return structuredClone(
        audit.filter(
          (event) =>
            !event.department || actor.departments.includes(event.department),
        ),
      );
    },
  };
}
