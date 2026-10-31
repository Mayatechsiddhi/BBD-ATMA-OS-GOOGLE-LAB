import { workforceIdentity } from "./identity";
import { z } from "zod";
import {
  workforceDatabase,
  assertWorkforceRuntime,
  tenantTransactionOptions,
} from "./database";
import {
  taskRequest,
  command,
  uuid,
  fingerprint,
  validateResult,
} from "../workforce-contract/contract";
import { mockAttempt } from "../workforce-contract/mock-adapter";

const taskCommand = command.extend({ taskId: uuid });
const operations = z.enum([
  "submit",
  "approve",
  "founder-approve",
  "claim",
  "retry",
  "revoke",
  "read",
  "audit",
  "pause",
  "resume",
  "disable-member",
]);
const commandInput = {
  approve: taskCommand,
  "founder-approve": taskCommand,
  claim: taskCommand,
  retry: taskCommand,
  revoke: taskCommand,
  read: z.strictObject({ taskId: uuid }),
  audit: z.strictObject({}),
  pause: z.strictObject({ expectedVersion: z.number().int().nonnegative() }),
  resume: z.strictObject({ expectedVersion: z.number().int().nonnegative() }),
  "disable-member": z.strictObject({
    userId: z.string().min(1).max(128),
    expectedVersion: z.number().int().nonnegative(),
  }),
};
export const departments = [
  "ENGINEERING",
  "SALES",
  "MARKETING",
  "FINANCE",
  "OPERATIONS",
  "SUPPORT",
] as const;

/** Internal library only: no customer routes, injected identities or executors.
 * A separate, authenticated ingress is a future integration gate. */
export async function createWorkforceControlPlane() {
  const db = workforceDatabase();
  try {
    await db.$transaction(assertWorkforceRuntime, tenantTransactionOptions);
  } catch {
    await db.$disconnect();
    throw new Error("Unsafe workforce runtime database");
  }
  let auth: ReturnType<typeof workforceIdentity>;
  try {
    auth = workforceIdentity(db);
  } catch (error) {
    await db.$disconnect();
    throw error;
  }
  async function scoped(
    headers: Headers,
    companyId: string,
    operation: string,
    data: unknown,
  ) {
    uuid.parse(companyId);
    // Only the signed workforce cookie is relevant. Ignore forged user/role
    // headers and customer session cookies. Never accept a userId parameter.
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: headers.get("cookie") ?? "" }),
    });
    if (!session?.user.emailVerified) throw new Error("ACCESS_DENIED");
    return db.$transaction(async (tx) => {
      await assertWorkforceRuntime(tx);
      await tx.$queryRaw`SELECT set_config('wf.transaction',pg_current_xact_id()::text,true),set_config('wf.actor',${session.user.id},true),set_config('wf.session',${session.session.id},true),set_config('wf.company',${companyId},true)`;
      const [row] = await tx.$queryRaw<
        { value: unknown }[]
      >`SELECT wf_private.dispatch(${operation},${companyId}::uuid,${JSON.stringify(data)}::jsonb) AS value`;
      return row.value;
    }, tenantTransactionOptions);
  }
  return {
    async command(
      headers: Headers,
      companyId: string,
      operation: unknown,
      input: unknown,
    ) {
      const op = operations.parse(operation);
      if (op === "submit") {
        const request = taskRequest.parse(input);
        if (request.scope.companyId !== companyId)
          throw new Error("ACCESS_DENIED");
        return scoped(headers, companyId, op, {
          request,
          digest: fingerprint(request),
        });
      }
      return scoped(headers, companyId, op, commandInput[op].parse(input));
    },
    async completeMock(headers: Headers, companyId: string, input: unknown) {
      const data = taskCommand.extend({ receiptId: uuid }).parse(input);
      const task = (await scoped(
        headers,
        companyId,
        "execution-input",
        data,
      )) as {
        request: unknown;
        digest: string;
        approvalId: string;
        attempts: number;
      };
      const request = taskRequest.parse(task.request);
      if (fingerprint(request) !== task.digest)
        throw new Error("Invalid persisted request digest");
      const outcome = mockAttempt(request, task.approvalId, task.attempts, {
        transientFailures: request.department === "OPERATIONS" ? 1 : 0,
        permanentFailure: false,
      });
      // No injected result, model, network, callback or customer data. Revalidate
      // output; finish re-authenticates and rechecks approval/revocation in SQL.
      const result =
        outcome.kind === "SUCCESS"
          ? validateResult(
              outcome.result,
              request,
              task.approvalId,
              task.attempts,
            )
          : null;
      return scoped(headers, companyId, "finish", {
        ...data,
        outcome: result ? "DRAFT_READY" : "RETRYABLE_FAILURE",
        result,
      });
    },
    close: () => db.$disconnect(),
  };
}
