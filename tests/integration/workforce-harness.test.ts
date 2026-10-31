import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMockWorkforceHarness,
  WorkforceError,
} from "../../src/modules/internal-workforce/harness";
import * as adapter from "../../src/modules/internal-workforce/mock-adapter";
import {
  actors,
  commandFor,
  company,
  harness,
  policy,
  request,
} from "../fixtures/workforce";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("internal company-scoped contract harness composition (no database or transport)", () => {
  it("completes Engineering and Operations drafts without a model, network or business operation", () => {
    const fetch = vi.fn(() => {
      throw new Error("Network forbidden");
    });
    vi.stubGlobal("fetch", fetch);
    const run = harness();
    for (const department of ["ENGINEERING", "OPERATIONS"] as const) {
      const input = request(department);
      let task = run.submit(actors.requester, input);
      expect(task.approvalState).toBe("PENDING");
      expect(() =>
        run.execute(actors.operator, input.taskId, commandFor(task)),
      ).toThrow("APPROVAL_REQUIRED");
      task = run.approve(actors.approver, input.taskId, commandFor(task));
      task = run.execute(actors.operator, input.taskId, commandFor(task));
      expect(task.executionStatus).toBe("DRAFT_READY");
      expect(task.result).toMatchObject({
        mock: true,
        requiresHumanReview: true,
        taskId: input.taskId,
        correlationId: input.correlationId,
      });
      expect(task.result!.artifact.content).toContain("Synthetic");
      expect(JSON.parse(JSON.stringify(task))).toEqual(task);
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(run.readAudit(actors.approver).map((event) => event.action)).toEqual(
      [
        "task.submitted",
        "task.approved",
        "task.started",
        "task.draft_ready",
        "task.submitted",
        "task.approved",
        "task.started",
        "task.draft_ready",
      ],
    );
  });
  it("denies cross-company and customer-tenant selectors, including known task IDs", () => {
    const a = harness(),
      foreign = randomUUID(),
      b = createMockWorkforceHarness(policy(foreign));
    const input = request(),
      owned = a.submit(actors.requester, input);
    expect(() =>
      a.submit(actors.requester, request("ENGINEERING", foreign)),
    ).toThrow("ACCESS_DENIED");
    expect(() => a.read(randomUUID(), input.taskId)).toThrow("ACCESS_DENIED");
    expect(() => b.read(actors.approver, input.taskId)).toThrow(
      "ACCESS_DENIED",
    );
    expect(() =>
      b.approve(actors.approver, input.taskId, commandFor(owned)),
    ).toThrow("ACCESS_DENIED");
    const bTask = b.submit(actors.requester, {
      ...input,
      scope: { ...input.scope, companyId: foreign },
    });
    expect(bTask.request.scope.companyId).toBe(foreign);
    expect(a.read(actors.requester, input.taskId).request.scope.companyId).toBe(
      company,
    );
  });
  it("allows identical submission replay but rejects conflicting input and duplicate logical requests", () => {
    const run = harness(),
      input = request();
    const first = run.submit(actors.requester, input);
    expect(run.submit(actors.requester, input)).toEqual(first);
    expect(run.readAudit(actors.approver)).toHaveLength(1);
    expect(() =>
      run.submit(actors.requester, {
        ...input,
        limits: { ...input.limits, maxAttempts: 3 },
      }),
    ).toThrow("CONFLICT");
    expect(() =>
      run.submit(actors.requester, { ...input, taskId: randomUUID() }),
    ).toThrow("CONFLICT");
    expect(() => run.submit(actors.otherRequester, input)).toThrow("CONFLICT");
  });
  it("rejects repeated execution without invoking the adapter or adding audits", () => {
    const run = harness(),
      input = request();
    const invoke = vi.spyOn(adapter, "mockAttempt");
    let task = run.submit(actors.requester, input);
    task = run.approve(actors.approver, input.taskId, commandFor(task));
    const approved = task;
    task = run.execute(actors.operator, input.taskId, commandFor(task));
    expect(() =>
      run.execute(actors.operator, input.taskId, commandFor(approved)),
    ).toThrow("ALREADY_EXECUTED");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(run.readAudit(actors.approver)).toHaveLength(4);
    expect(run.submit(actors.requester, input)).toEqual(task);
  });
  it("separates submit/approve/execute authority, denies department leaks and ignores caller mutation", () => {
    const config = policy(),
      run = createMockWorkforceHarness(config),
      input = request("OPERATIONS");
    const task = run.submit(actors.requester, input);
    for (const id of [
      actors.requester,
      actors.operator,
      actors.otherRequester,
      randomUUID(),
    ])
      expect(() => run.approve(id, input.taskId, commandFor(task))).toThrow(
        "ACCESS_DENIED",
      );
    expect(() => run.read(actors.otherRequester, input.taskId)).toThrow(
      "ACCESS_DENIED",
    );
    expect(() => run.read(actors.engineer, input.taskId)).toThrow(
      "ACCESS_DENIED",
    );
    expect(() =>
      run.approve(actors.engineeringApprover, input.taskId, commandFor(task)),
    ).toThrow("ACCESS_DENIED");
    expect(run.readAudit(actors.engineeringApprover)).toEqual([]);
    config.principals[0].role = "APPROVER";
    expect(() =>
      run.approve(actors.requester, input.taskId, commandFor(task)),
    ).toThrow("ACCESS_DENIED");
    task.approvalState = "APPROVED";
    task.executionStatus = "DRAFT_READY";
    expect(run.read(actors.requester, input.taskId).approvalState).toBe(
      "PENDING",
    );
  });
  it("binds approval and commands to the exact request digest/version and rejects invalid transitions", () => {
    const run = harness(),
      input = request();
    let task = run.submit(actors.requester, input);
    expect(() =>
      run.approve(actors.approver, input.taskId, {
        ...commandFor(task),
        requestDigest: "0".repeat(64),
      }),
    ).toThrow("CONFLICT");
    expect(() =>
      run.retry(actors.operator, input.taskId, commandFor(task)),
    ).toThrow("APPROVAL_REQUIRED");
    task = run.approve(actors.approver, input.taskId, commandFor(task));
    expect(() =>
      run.approve(actors.approver, input.taskId, {
        ...commandFor(task),
        role: "APPROVER",
      }),
    ).toThrow();
    expect(() =>
      run.approve(actors.approver, input.taskId, commandFor(task)),
    ).toThrow("INVALID_TRANSITION");
    expect(() =>
      run.execute(actors.approver, input.taskId, commandFor(task)),
    ).toThrow("ACCESS_DENIED");
    expect(() =>
      run.execute(actors.operator, input.taskId, {
        ...commandFor(task),
        expectedVersion: 0,
      }),
    ).toThrow("CONFLICT");
  });
  it("supports explicit bounded retries only; never retries automatically", () => {
    const config = policy();
    config.mockPlan.ENGINEERING.transientFailures = 1;
    const run = createMockWorkforceHarness(config),
      input = request();
    const invoke = vi.spyOn(adapter, "mockAttempt");
    let task = run.submit(actors.requester, input);
    task = run.approve(actors.approver, input.taskId, commandFor(task));
    task = run.execute(actors.operator, input.taskId, commandFor(task));
    expect(task.executionStatus).toBe("RETRYABLE_FAILURE");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(() =>
      run.execute(actors.operator, input.taskId, commandFor(task)),
    ).toThrow("INVALID_TRANSITION");
    task = run.retry(actors.operator, input.taskId, commandFor(task));
    task = run.execute(actors.operator, input.taskId, commandFor(task));
    expect(task.attempts).toBe(2);
    expect(task.executionStatus).toBe("DRAFT_READY");
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it("stops at the attempt cap and does not retry permanent failures", () => {
    const config = policy();
    config.mockPlan.ENGINEERING.transientFailures = 3;
    config.mockPlan.OPERATIONS.permanentFailure = true;
    const run = createMockWorkforceHarness(config);
    for (const department of ["ENGINEERING", "OPERATIONS"] as const) {
      const input = request(department);
      let task = run.submit(actors.requester, input);
      task = run.approve(actors.approver, input.taskId, commandFor(task));
      task = run.execute(actors.operator, input.taskId, commandFor(task));
      if (department === "ENGINEERING") {
        task = run.retry(actors.operator, input.taskId, commandFor(task));
        task = run.execute(actors.operator, input.taskId, commandFor(task));
      }
      expect(task.executionStatus).toBe("FAILED");
      expect(task.attempts).toBe(department === "ENGINEERING" ? 2 : 1);
      expect(() =>
        run.retry(actors.operator, input.taskId, commandFor(task)),
      ).toThrow("INVALID_TRANSITION");
    }
  });
  it("rejects expired/future requests and rechecks expiry before execution and retry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-31T06:00:00Z"));
    const run = harness(),
      input = request();
    expect(() =>
      run.submit(actors.requester, {
        ...input,
        createdAt: "2026-10-31T06:01:00.000Z",
      }),
    ).toThrow("EXPIRED");
    let task = run.submit(actors.requester, input);
    task = run.approve(actors.approver, input.taskId, commandFor(task));
    vi.advanceTimersByTime(600001);
    expect(() =>
      run.execute(actors.operator, input.taskId, commandFor(task)),
    ).toThrow("EXPIRED");
    expect(run.read(actors.requester, input.taskId).attempts).toBe(0);
    expect(() =>
      run.submit(actors.requester, request("OPERATIONS")),
    ).not.toThrow();
  });
  it("revokes approval before execution/retry and can invalidate a previously produced mock result", () => {
    const config = policy();
    config.mockPlan.ENGINEERING.transientFailures = 1;
    const run = createMockWorkforceHarness(config),
      input = request();
    let task = run.submit(actors.requester, input);
    task = run.approve(actors.approver, input.taskId, commandFor(task));
    task = run.execute(actors.operator, input.taskId, commandFor(task));
    task = run.revoke(actors.approver, input.taskId, commandFor(task));
    expect(() =>
      run.retry(actors.operator, input.taskId, commandFor(task)),
    ).toThrow("APPROVAL_REQUIRED");
    expect(() =>
      run.approve(actors.approver, input.taskId, commandFor(task)),
    ).toThrow("INVALID_TRANSITION");
    const ops = request("OPERATIONS");
    let ready = run.submit(actors.requester, ops);
    ready = run.approve(actors.approver, ops.taskId, commandFor(ready));
    ready = run.execute(actors.operator, ops.taskId, commandFor(ready));
    expect(ready.result).toBeDefined();
    ready = run.revoke(actors.approver, ops.taskId, commandFor(ready));
    expect(ready.result).toBeUndefined();
    expect(ready.executionStatus).toBe("CANCELLED");
  });
  it("supports rejection and a capability-gated kill switch without clearing idempotency", () => {
    const run = harness(),
      input = request();
    let task = run.submit(actors.requester, input);
    expect(() => run.setPaused(actors.operator, true)).toThrow("ACCESS_DENIED");
    run.setPaused(actors.approver, true);
    expect(() =>
      run.approve(actors.approver, input.taskId, commandFor(task)),
    ).toThrow("PAUSED");
    expect(run.submit(actors.requester, input)).toEqual(task);
    expect(() => run.submit(actors.requester, request())).toThrow("PAUSED");
    run.setPaused(actors.approver, false);
    task = run.reject(actors.approver, input.taskId, commandFor(task));
    expect(task.approvalState).toBe("REJECTED");
    expect(() =>
      run.execute(actors.operator, input.taskId, commandFor(task)),
    ).toThrow("APPROVAL_REQUIRED");
  });
  it("reserves bounded audit capacity before state changes and prevents caller audit/result mutation", () => {
    const config = policy();
    config.maxAudit = 3;
    config.maxTasks = 1;
    const run = createMockWorkforceHarness(config),
      input = request();
    let task = run.submit(actors.requester, input);
    task = run.approve(actors.approver, input.taskId, commandFor(task));
    expect(() =>
      run.execute(actors.operator, input.taskId, commandFor(task)),
    ).toThrow("CAPACITY");
    expect(run.read(actors.requester, input.taskId)).toEqual(task);
    expect(() => run.submit(actors.requester, request())).toThrow("CAPACITY");
    const audit = run.readAudit(actors.approver);
    audit[0].action = "forged";
    expect(run.readAudit(actors.approver)[0].action).toBe("task.submitted");
  });
  it("revalidates the adapter boundary and refuses a forged cross-company result", () => {
    const original = adapter.mockAttempt;
    const run = harness(),
      input = request();
    let task = run.submit(actors.requester, input);
    task = run.approve(actors.approver, input.taskId, commandFor(task));
    vi.spyOn(adapter, "mockAttempt").mockImplementationOnce((...args) => {
      const outcome = original(...args);
      if (outcome.kind === "SUCCESS")
        outcome.result.scope.companyId = randomUUID();
      return outcome;
    });
    task = run.execute(actors.operator, input.taskId, commandFor(task));
    expect(task.executionStatus).toBe("FAILED");
    expect(task.result).toBeUndefined();
  });
  it("records a terminal failure without leaking unexpected adapter error details", () => {
    const run = harness(),
      input = request();
    let task = run.submit(actors.requester, input);
    task = run.approve(actors.approver, input.taskId, commandFor(task));
    vi.spyOn(adapter, "mockAttempt").mockImplementationOnce(() => {
      throw new Error("private synthetic diagnostics");
    });
    task = run.execute(actors.operator, input.taskId, commandFor(task));
    expect(task.executionStatus).toBe("FAILED");
    expect(task.result).toBeUndefined();
    expect(JSON.stringify(run.readAudit(actors.approver))).not.toContain(
      "diagnostics",
    );
    expect(
      run.readAudit(actors.approver).map((event) => event.executionStatus),
    ).toEqual(["QUEUED", "QUEUED", "RUNNING", "FAILED"]);
  });
  it("preserves emergency pause and revocation evidence at full normal capacity", () => {
    const config = policy();
    config.maxAudit = 4;
    const run = createMockWorkforceHarness(config),
      input = request();
    let task = run.submit(actors.requester, input);
    task = run.approve(actors.approver, input.taskId, commandFor(task));
    task = run.execute(actors.operator, input.taskId, commandFor(task));
    run.setPaused(actors.approver, true);
    expect(() => run.setPaused(actors.approver, false)).toThrow("CAPACITY");
    const revoked = run.revoke(actors.approver, input.taskId, commandFor(task));
    expect(revoked.approvalState).toBe("REVOKED");
    expect(revoked.result).toBeUndefined();
    expect(() =>
      run.revoke(actors.approver, input.taskId, commandFor(revoked)),
    ).toThrow("INVALID_TRANSITION");
    run.setPaused(actors.approver, true);
    const audit = run.readAudit(actors.approver);
    expect(audit.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(audit.slice(-2).map((event) => event.action)).toEqual([
      "harness.paused",
      "task.revoked",
    ]);
    expect(() =>
      run.execute(actors.operator, input.taskId, commandFor(revoked)),
    ).toThrow("PAUSED");
  });
  it("actually denies expired retry without spending another attempt or changing state", () => {
    vi.useFakeTimers();
    const config = policy();
    config.mockPlan.ENGINEERING.transientFailures = 1;
    const run = createMockWorkforceHarness(config),
      input = request();
    let task = run.submit(actors.requester, input);
    task = run.approve(actors.approver, input.taskId, commandFor(task));
    task = run.execute(actors.operator, input.taskId, commandFor(task));
    expect(task.executionStatus).toBe("RETRYABLE_FAILURE");
    vi.advanceTimersByTime(600001);
    expect(() =>
      run.retry(actors.operator, input.taskId, commandFor(task)),
    ).toThrow("EXPIRED");
    expect(run.read(actors.requester, input.taskId)).toEqual(task);
  });
  it("denies paused retry and execution until an audited resume", () => {
    const config = policy();
    config.mockPlan.ENGINEERING.transientFailures = 1;
    const run = createMockWorkforceHarness(config),
      input = request();
    let task = run.submit(actors.requester, input);
    task = run.approve(actors.approver, input.taskId, commandFor(task));
    task = run.execute(actors.operator, input.taskId, commandFor(task));
    run.setPaused(actors.approver, true);
    expect(() =>
      run.retry(actors.operator, input.taskId, commandFor(task)),
    ).toThrow("PAUSED");
    expect(() =>
      run.execute(actors.operator, input.taskId, commandFor(task)),
    ).toThrow("PAUSED");
    expect(run.read(actors.requester, input.taskId)).toEqual(task);
    run.setPaused(actors.approver, false);
    task = run.retry(actors.operator, input.taskId, commandFor(task));
    expect(
      run.execute(actors.operator, input.taskId, commandFor(task))
        .executionStatus,
    ).toBe("DRAFT_READY");
  });
  it("bounds privacy-safe denial counters independently of the state/audit ledger", () => {
    const run = harness();
    for (let n = 0; n < 1000; n++)
      expect(() => run.read(randomUUID(), `private-task-${n}`)).toThrow(
        "ACCESS_DENIED",
      );
    expect(() =>
      run.submit(actors.requester, { password: "private-input" }),
    ).toThrow();
    expect(() => run.readDeniedTelemetry(actors.requester)).toThrow(
      "ACCESS_DENIED",
    );
    expect(() => run.readDeniedTelemetry(actors.engineeringApprover)).toThrow(
      "ACCESS_DENIED",
    );
    const counters = run.readDeniedTelemetry(actors.approver);
    expect(counters).toContainEqual({
      action: "read",
      reason: "ACCESS_DENIED",
      count: 1000,
    });
    expect(counters).toContainEqual({
      action: "submit",
      reason: "INVALID_INPUT",
      count: 1,
    });
    expect(counters).toHaveLength(3);
    expect(JSON.stringify(counters)).not.toMatch(/private-|password|00000000/);
    counters[0].count = 0;
    expect(run.readDeniedTelemetry(actors.approver)[0].count).toBe(1000);
    expect(run.readAudit(actors.approver)).toEqual([]);
  });
  it("can revoke every approved task after the normal ledger fills without losing evidence", () => {
    const config = policy();
    config.maxAudit = 4;
    config.maxTasks = 2;
    const run = createMockWorkforceHarness(config);
    const tasks = [request(), request("OPERATIONS")].map((input) => {
      const submitted = run.submit(actors.requester, input);
      return run.approve(actors.approver, input.taskId, commandFor(submitted));
    });
    for (const task of tasks) {
      const revoked = run.revoke(
        actors.approver,
        task.request.taskId,
        commandFor(task),
      );
      expect(revoked.executionStatus).toBe("CANCELLED");
      expect(() =>
        run.execute(actors.operator, task.request.taskId, commandFor(revoked)),
      ).toThrow("APPROVAL_REQUIRED");
    }
    run.setPaused(actors.approver, true);
    for (let n = 0; n < 10; n++) {
      run.setPaused(actors.approver, true);
      expect(() => run.setPaused(actors.approver, false)).toThrow("CAPACITY");
    }
    expect(run.readAudit(actors.approver)).toHaveLength(7);
    expect(
      run
        .readAudit(actors.engineeringApprover)
        .filter((event) => event.department === "OPERATIONS"),
    ).toEqual([]);
  });
  it("never retains forged error codes as denial telemetry labels", () => {
    const run = harness();
    const input = request();
    const error = new WorkforceError("ACCESS_DENIED");
    Object.defineProperty(error, "code", { value: "private-forged-label" });
    Object.defineProperty(input, "taskId", {
      get() {
        throw error;
      },
    });
    expect(() => run.submit(actors.requester, input)).toThrow(error);
    expect(run.readDeniedTelemetry(actors.approver)).toEqual([]);
    expect(run.readAudit(actors.approver)).toEqual([]);
  });
});
