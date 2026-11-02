"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { logger } from "@/lib/logger";
import {
  runTenantWorkerCycle,
  setTenantWorkerState,
  retryDeadLetterTasks,
  dispatchWorkflowDomainEvent,
  getTenantWorkerMetrics,
  getTenantRecentTasks,
  type WorkerState,
} from "@/modules/workflows/worker-orchestrator";

export async function runWorkerCycleAction(org: string) {
  const { user } = await requireSession();
  try {
    const result = await runTenantWorkerCycle(org, 10);
    logger.info({
      event: "orchestrator.cycle.invoked",
      actorId: user.id,
      organizationId: org,
      result,
    });
    revalidatePath(`/organizations/${org}/clinic/orchestrator`);
    return { success: true as const, processed: result.processed, succeeded: result.succeeded, failed: result.failed, error: undefined };
  } catch (error) {
    logger.error({
      event: "orchestrator.cycle.failed",
      error: error instanceof Error ? error.message : "unknown",
    });
    return { success: false as const, processed: 0, succeeded: 0, failed: 0, error: "Failed to run worker cycle" };
  }
}

export async function toggleWorkerStateAction(org: string, nextState: WorkerState) {
  const { user } = await requireSession();
  try {
    const state = setTenantWorkerState(org, nextState);
    logger.info({
      event: "orchestrator.state.changed",
      actorId: user.id,
      organizationId: org,
      state,
    });
    revalidatePath(`/organizations/${org}/clinic/orchestrator`);
    return { success: true, state };
  } catch {
    return { success: false, error: "Failed to change worker state" };
  }
}

export async function retryDeadLetterAction(org: string) {
  const { user } = await requireSession();
  try {
    const reQueued = retryDeadLetterTasks(org);
    logger.info({
      event: "orchestrator.dead_letter.retried",
      actorId: user.id,
      organizationId: org,
      reQueued,
    });
    revalidatePath(`/organizations/${org}/clinic/orchestrator`);
    return { success: true, reQueued };
  } catch {
    return { success: false, error: "Failed to re-queue dead letter tasks" };
  }
}

export async function simulateDomainEventAction(
  org: string,
  eventType: string,
  payload: Record<string, unknown>,
) {
  const { user } = await requireSession();
  try {
    const tasks = await dispatchWorkflowDomainEvent(org, eventType, payload);
    logger.info({
      event: "orchestrator.event.simulated",
      actorId: user.id,
      organizationId: org,
      eventType,
      tasksCount: tasks.length,
    });
    revalidatePath(`/organizations/${org}/clinic/orchestrator`);
    return { success: true, tasks };
  } catch {
    return { success: false, error: "Failed to dispatch domain event" };
  }
}

export async function getOrchestratorDataAction(org: string) {
  await requireSession();
  const metrics = getTenantWorkerMetrics(org);
  const tasks = getTenantRecentTasks(org, 30);
  return { metrics, tasks };
}
