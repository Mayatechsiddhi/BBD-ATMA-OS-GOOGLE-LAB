import { createHash } from "node:crypto";
import { z } from "zod";
import { workforceIdentity } from "./identity";
import {
  workforceDatabase,
  assertWorkforceRuntime,
  tenantTransactionOptions,
} from "./database";
import { uuid } from "../workforce-contract/contract";
import type {
  WorkforceTask,
  WorkforceReceipt,
} from "@/generated/workforce/client";

const selection = z.strictObject({
  companyId: uuid,
  after: uuid.optional(),
  taskId: uuid.optional(),
});
const roles = ["REQUESTER", "APPROVER", "FOUNDER", "EXECUTOR"] as const;
const statuses = [
  "QUEUED",
  "RUNNING",
  "DRAFT_READY",
  "RETRYABLE_FAILURE",
  "FAILED",
  "CANCELLED",
];
const approvals = ["PENDING", "APPROVED", "REVOKED"];
const actions = [
  "task.submitted",
  "task.approver-consent",
  "task.founder-consent",
  "task.claimed",
  "task.draft_ready",
  "task.retryable_failure",
  "task.failed",
  "task.retry-requested",
  "task.revoked",
  "company.pause",
  "company.resume",
  "member.disabled",
];
export function actorLabel(company: string, actor: string | null) {
  return actor
    ? `member-${createHash("sha256").update(`${company}:${actor}`).digest("hex").slice(0, 12)}`
    : null;
}
// Closed projection: no free text, requests/results, emails, sessions or credentials.
export function projectTask(
  task: Omit<WorkforceTask, "request" | "result">,
  receipts: WorkforceReceipt[],
  now: Date,
) {
  const latest = receipts.at(-1);
  const stale =
    task.status === "RUNNING" &&
    (!latest ||
      now.getTime() - latest.createdAt.getTime() > 120000 ||
      task.expiresAt <= now ||
      !task.approvalUntil ||
      task.approvalUntil <= now);
  return {
    id: task.id,
    department: ["ENGINEERING", "OPERATIONS"].includes(task.department)
      ? task.department
      : "UNKNOWN",
    status: statuses.includes(task.status) ? task.status : "UNKNOWN",
    activity:
      task.status === "RUNNING"
        ? stale
          ? "Stale claim — outcome unknown"
          : "Claimed — activity unconfirmed"
        : "No live activity evidence",
    version: task.version,
    attempts: task.attempts,
    expiresAt: task.expiresAt.toISOString(),
    submittedBy: actorLabel(task.companyId, task.submittedBy),
    approval: {
      state: approvals.includes(task.approvalState)
        ? task.approvalState
        : "UNKNOWN",
      expiresAt: task.approvalUntil?.toISOString() ?? null,
      approver: actorLabel(task.companyId, task.approverId),
      founder: actorLabel(task.companyId, task.founderId),
      expired: !!task.approvalUntil && task.approvalUntil <= now,
    },
    receipts: receipts.map((r) => ({
      id: r.id,
      attempt: r.attempt,
      status: ["CLAIMED", ...statuses].includes(r.status)
        ? r.status
        : "UNKNOWN",
      executor: actorLabel(task.companyId, r.executorId),
      createdAt: r.createdAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      bindingMatches:
        r.digest === task.digest && r.approvalId === task.approvalId,
    })),
    evidence:
      "No task-specific test evidence recorded. Receipts are execution records, not independent verification.",
  };
}
export async function createWorkforceReader() {
  const db = workforceDatabase();
  let auth: ReturnType<typeof workforceIdentity>;
  try {
    await db.$transaction(assertWorkforceRuntime, tenantTransactionOptions);
    auth = workforceIdentity(db);
  } catch {
    await db.$disconnect();
    throw new Error("Workforce reader initialization failed");
  }
  return {
    // Authentication maintenance only; no business commands or execution methods.
    signIn: (headers: Headers, email: string, password: string) =>
      auth.api.signInEmail({
        headers,
        body: { email, password },
        asResponse: true,
      }),
    async snapshot(headers: Headers, input: unknown) {
      const scope = selection.parse(input);
      const session = await auth.api.getSession({
        headers: new Headers({ cookie: headers.get("cookie") ?? "" }),
      });
      if (!session?.user.emailVerified) throw new Error("ACCESS_DENIED");
      return db.$transaction(async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await assertWorkforceRuntime(tx);
        // Shared with the controller's exclusive company lock. No row locks or mutation dispatch.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${scope.companyId}::uuid::text,71))::text`;
        await tx.$queryRaw`SELECT set_config('wf.transaction',pg_current_xact_id()::text,true),set_config('wf.actor',${session.user.id},true),set_config('wf.session',${session.session.id},true),set_config('wf.company',${scope.companyId},true)`;
        const member = await tx.workforceMember.findUnique({
          where: {
            companyId_userId: {
              companyId: scope.companyId,
              userId: session.user.id,
            },
          },
        });
        if (
          !member?.active ||
          !(roles as readonly string[]).includes(member.role)
        )
          throw new Error("ACCESS_DENIED");
        const company = await tx.workforceCompany.findUnique({
          where: { id: scope.companyId },
        });
        if (!company) throw new Error("ACCESS_DENIED");
        const where = {
          companyId: scope.companyId,
          ...(member.role === "REQUESTER"
            ? { submittedBy: session.user.id }
            : {}),
        };
        const tasks = await tx.workforceTask.findMany({
          where: {
            ...where,
            ...(scope.after ? { id: { gt: scope.after } } : {}),
          },
          orderBy: { id: "asc" },
          omit: { request: true, result: true },
          take: 51,
        });
        const selected = scope.taskId
          ? await tx.workforceTask.findFirst({
              where: { ...where, id: scope.taskId },
              omit: { request: true, result: true },
            })
          : null;
        if (scope.taskId && !selected) throw new Error("ACCESS_DENIED");
        const page = tasks.slice(0, 50);
        const visible =
          selected && !page.some((t) => t.id === selected.id)
            ? [...page, selected]
            : page;
        const receipts = visible.length
          ? await tx.workforceReceipt.findMany({
              where: {
                companyId: scope.companyId,
                taskId: { in: visible.map((t) => t.id) },
              },
              orderBy: [{ taskId: "asc" }, { attempt: "asc" }],
              take: 153,
            })
          : [];
        const canAudit =
          member.role === "APPROVER" || member.role === "FOUNDER";
        const audit = canAudit
          ? await tx.workforceAudit.findMany({
              where: { companyId: scope.companyId },
              orderBy: { id: "desc" },
              take: 100,
            })
          : [];
        // Recheck at response boundary; RLS also checks current session/membership on every query.
        if (
          !(await tx.workforceMember.findUnique({
            where: {
              companyId_userId: {
                companyId: scope.companyId,
                userId: session.user.id,
              },
            },
          }))
        )
          throw new Error("ACCESS_DENIED");
        const now = new Date();
        const project = (t: Omit<WorkforceTask, "request" | "result">) =>
          projectTask(
            t,
            receipts.filter((r) => r.taskId === t.id),
            now,
          );
        return {
          companyId: company.id,
          paused: company.paused,
          role: member.role,
          retrievedAt: now.toISOString(),
          tasks: page.map(project),
          selected: selected ? project(selected) : null,
          next: tasks.length > 50 ? page.at(-1)!.id : null,
          canAudit,
          audit: audit.map((a, index) => ({
            // Snapshot-local position, not the cross-company global sequence.
            id: String(index + 1),
            taskId: a.taskId,
            action: actions.includes(a.action)
              ? a.action
              : "Other recorded event",
            actor: actorLabel(company.id, a.actorId),
            subject: actorLabel(company.id, a.subjectUserId),
            version: a.version,
            createdAt: a.createdAt.toISOString(),
          })),
        };
      }, tenantTransactionOptions);
    },
    close: () => db.$disconnect(),
  };
}
export type WorkforceSnapshot = Awaited<
  ReturnType<Awaited<ReturnType<typeof createWorkforceReader>>["snapshot"]>
>;
