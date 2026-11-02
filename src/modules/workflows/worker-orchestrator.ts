import { randomUUID } from "node:crypto";
import { logger } from "@/lib/logger";
import {
  triggerLeadQualification,
  triggerAppointmentFollowUpAI,
} from "./ai-triggers";
import type { WorkflowDomainEventType } from "./event-types";

export type TaskStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "DEAD_LETTER";
export type WorkerState = "ACTIVE" | "PAUSED";

export interface BackgroundWorkerTask {
  id: string;
  organizationId: string;
  eventId: string;
  eventType: WorkflowDomainEventType | string;
  handlerName: string;
  status: TaskStatus;
  attempts: number;
  maxAttempts: number;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  lastError?: string;
  payload: Record<string, unknown>;
  outputResult?: Record<string, unknown>;
}

export interface WorkerOrchestratorMetrics {
  organizationId: string;
  workerState: WorkerState;
  totalEnqueued: number;
  totalCompleted: number;
  totalFailed: number;
  totalDeadLetter: number;
  queueDepth: number;
  avgDurationMs: number;
  lastCycleAt?: string;
}

// In-memory tenant-partitioned task registry
const taskStore: BackgroundWorkerTask[] = [];
const workerStateStore: Record<string, WorkerState> = {};
const processedIdempotencyKeys = new Set<string>();

// Pre-seed initial tasks for demo/testing convenience
function ensureInitialSeed(organizationId: string) {
  if (taskStore.some((t) => t.organizationId === organizationId)) return;

  const now = new Date(Date.now() - 1000 * 60 * 15).toISOString();
  taskStore.push({
    id: `task_${randomUUID().substring(0, 8)}`,
    organizationId,
    eventId: `evt_${randomUUID().substring(0, 8)}`,
    eventType: "clinic.lead.created",
    handlerName: "aiLeadQualificationHandler",
    status: "COMPLETED",
    attempts: 1,
    maxAttempts: 3,
    queuedAt: now,
    startedAt: now,
    completedAt: new Date(Date.now() - 1000 * 60 * 14).toISOString(),
    durationMs: 420,
    payload: {
      leadId: "lead_initial_01",
      name: "Siddharth Sen",
      phone: "+91 98450 12345",
      treatmentInterest: "Cardiac Screening & Preventive Health",
      source: "Corporate Referral",
    },
    outputResult: {
      priority: "HIGH",
      summary: "Patient qualified for comprehensive preventive cardiac package.",
    },
  });

  taskStore.push({
    id: `task_${randomUUID().substring(0, 8)}`,
    organizationId,
    eventId: `evt_${randomUUID().substring(0, 8)}`,
    eventType: "clinic.appointment.booked",
    handlerName: "aiAppointmentCarePlanHandler",
    status: "COMPLETED",
    attempts: 1,
    maxAttempts: 3,
    queuedAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
    startedAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
    completedAt: new Date(Date.now() - 1000 * 60 * 7).toISOString(),
    durationMs: 380,
    payload: {
      appointmentId: "apt_initial_02",
      patientName: "Meera Nair",
      doctorName: "Dr. R. K. Verma",
      startsAt: new Date().toISOString(),
      clinicalNotes: "Follow-up consultation for orthopedic rehab.",
    },
    outputResult: {
      recallDays: 14,
      bilingualPlanCreated: true,
    },
  });
}

/**
 * Dispatches an event into the automated background orchestration pipeline
 */
export async function dispatchWorkflowDomainEvent(
  organizationId: string,
  eventType: WorkflowDomainEventType | string,
  payload: Record<string, unknown>,
): Promise<BackgroundWorkerTask[]> {
  const eventId = `evt_${Date.now()}_${randomUUID().substring(0, 6)}`;
  const createdTasks: BackgroundWorkerTask[] = [];

  // Determine handlers based on event subscription
  const handlers: string[] = [];
  if (eventType === "clinic.lead.created") {
    handlers.push("aiLeadQualificationHandler");
    handlers.push("crmLeadSyncNotificationHandler");
  } else if (eventType === "clinic.appointment.booked") {
    handlers.push("aiAppointmentCarePlanHandler");
    handlers.push("patientConfirmationDispatcher");
  } else if (eventType === "clinic.queue.token_called") {
    handlers.push("liveTvBroadcastHandler");
    handlers.push("patientSmsReminderHandler");
  } else if (eventType === "clinic.billing.payment_settled") {
    handlers.push("zeroFeeLedgerReconciliationHandler");
    handlers.push("patientInvoiceReceiptGenerator");
  } else {
    handlers.push("genericDomainEventHandler");
  }

  for (const handlerName of handlers) {
    const idempotencyKey = `${organizationId}:${eventId}:${handlerName}`;
    if (processedIdempotencyKeys.has(idempotencyKey)) continue;

    const task: BackgroundWorkerTask = {
      id: `task_${randomUUID().substring(0, 10)}`,
      organizationId,
      eventId,
      eventType,
      handlerName,
      status: "QUEUED",
      attempts: 0,
      maxAttempts: 3,
      queuedAt: new Date().toISOString(),
      payload,
    };

    taskStore.unshift(task);
    createdTasks.push(task);
  }

  logger.info({
    event: "orchestrator.event.dispatched",
    organizationId,
    eventType,
    eventId,
    tasksCreated: createdTasks.length,
  });

  return createdTasks;
}

/**
 * Executes a worker processing cycle for the tenant
 */
export async function runTenantWorkerCycle(
  organizationId: string,
  batchLimit = 10,
): Promise<{ processed: number; succeeded: number; failed: number }> {
  ensureInitialSeed(organizationId);

  const state = workerStateStore[organizationId] || "ACTIVE";
  if (state === "PAUSED") {
    logger.warn({
      event: "orchestrator.cycle.skipped",
      organizationId,
      reason: "Worker paused by operator",
    });
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  // Find queued tasks for this tenant
  const queuedTasks = taskStore
    .filter((t) => t.organizationId === organizationId && (t.status === "QUEUED" || t.status === "FAILED"))
    .slice(0, batchLimit);

  let succeeded = 0;
  let failed = 0;

  for (const task of queuedTasks) {
    task.status = "RUNNING";
    task.startedAt = new Date().toISOString();
    task.attempts += 1;
    const startTime = Date.now();

    try {
      const result = await executeTaskHandler(task);
      task.status = "COMPLETED";
      task.completedAt = new Date().toISOString();
      task.durationMs = Date.now() - startTime;
      task.outputResult = result;
      processedIdempotencyKeys.add(`${organizationId}:${task.eventId}:${task.handlerName}`);
      succeeded += 1;
    } catch (err) {
      task.durationMs = Date.now() - startTime;
      task.lastError = err instanceof Error ? err.message : "Unknown execution failure";
      if (task.attempts >= task.maxAttempts) {
        task.status = "DEAD_LETTER";
      } else {
        task.status = "FAILED";
      }
      failed += 1;
      logger.error({
        event: "orchestrator.task.failed",
        taskId: task.id,
        handler: task.handlerName,
        attempts: task.attempts,
        error: task.lastError,
      });
    }
  }

  return { processed: queuedTasks.length, succeeded, failed };
}

/**
 * Task Execution Dispatcher
 */
async function executeTaskHandler(task: BackgroundWorkerTask): Promise<Record<string, unknown>> {
  const { handlerName, organizationId, payload } = task;

  if (handlerName === "aiLeadQualificationHandler") {
    const proposal = await triggerLeadQualification({
      organizationId,
      leadId: String(payload.leadId || `lead_${Date.now()}`),
      name: String(payload.name || "Prospective Patient"),
      phone: String(payload.phone || ""),
      treatmentInterest: typeof payload.treatmentInterest === "string" ? payload.treatmentInterest : undefined,
      source: typeof payload.source === "string" ? payload.source : undefined,
    });
    return {
      proposalId: proposal.id,
      priority: proposal.suggestedAction,
      confidence: proposal.confidenceScore,
      action: "Lead analyzed and proposal registered in AI review queue",
    };
  }

  if (handlerName === "aiAppointmentCarePlanHandler") {
    const proposal = await triggerAppointmentFollowUpAI({
      organizationId,
      appointmentId: String(payload.appointmentId || `apt_${Date.now()}`),
      patientName: String(payload.patientName || "Patient"),
      doctorName: String(payload.doctorName || "Doctor"),
      appointmentTime: String(payload.startsAt || new Date().toISOString()),
      clinicalNotes: typeof payload.clinicalNotes === "string" ? payload.clinicalNotes : undefined,
    });
    return {
      proposalId: proposal.id,
      carePlanSummary: proposal.summary,
      action: "Post-care protocol formulated with bilingual patient draft",
    };
  }

  if (handlerName === "liveTvBroadcastHandler") {
    // Simulates queue token broadcast event to SSE/WebSocket display channels
    return {
      broadcastChannel: `/display/${organizationId}`,
      tokenNumber: payload.tokenNumber,
      room: payload.room,
      dispatchedAt: new Date().toISOString(),
      displayStatus: "CALLING_ACTIVE",
    };
  }

  if (handlerName === "zeroFeeLedgerReconciliationHandler") {
    return {
      reconciledAmountPaise: payload.amountPaise,
      gateway: payload.gateway || "DIRECT_UPI_QR",
      commissionSavedInr: Number(payload.amountPaise || 0) * 0.02 / 100,
      settlementLedger: "CONFIRMED_ZERO_FEE",
      timestamp: new Date().toISOString(),
    };
  }

  // Fallback for notification & confirmation handlers
  return {
    executed: true,
    handler: handlerName,
    message: "Automated event notification dispatched successfully",
    timestamp: new Date().toISOString(),
  };
}

/**
 * Retrieves Worker Metrics for a Tenant
 */
export function getTenantWorkerMetrics(organizationId: string): WorkerOrchestratorMetrics {
  ensureInitialSeed(organizationId);

  const orgTasks = taskStore.filter((t) => t.organizationId === organizationId);
  const completed = orgTasks.filter((t) => t.status === "COMPLETED");
  const failed = orgTasks.filter((t) => t.status === "FAILED");
  const deadLetter = orgTasks.filter((t) => t.status === "DEAD_LETTER");
  const queued = orgTasks.filter((t) => t.status === "QUEUED" || t.status === "RUNNING");

  const totalDuration = completed.reduce((sum, t) => sum + (t.durationMs || 0), 0);
  const avgDurationMs = completed.length > 0 ? Math.round(totalDuration / completed.length) : 350;

  return {
    organizationId,
    workerState: workerStateStore[organizationId] || "ACTIVE",
    totalEnqueued: orgTasks.length,
    totalCompleted: completed.length,
    totalFailed: failed.length,
    totalDeadLetter: deadLetter.length,
    queueDepth: queued.length,
    avgDurationMs,
    lastCycleAt: completed[0]?.completedAt || new Date().toISOString(),
  };
}

/**
 * Returns recent worker tasks
 */
export function getTenantRecentTasks(organizationId: string, limit = 25): BackgroundWorkerTask[] {
  ensureInitialSeed(organizationId);
  return taskStore
    .filter((t) => t.organizationId === organizationId)
    .slice(0, limit);
}

/**
 * Pause / Resume Worker
 */
export function setTenantWorkerState(organizationId: string, state: WorkerState): WorkerState {
  workerStateStore[organizationId] = state;
  return state;
}

/**
 * Re-queue dead letter tasks
 */
export function retryDeadLetterTasks(organizationId: string): number {
  let count = 0;
  for (const task of taskStore) {
    if (task.organizationId === organizationId && task.status === "DEAD_LETTER") {
      task.status = "QUEUED";
      task.attempts = 0;
      task.lastError = undefined;
      count += 1;
    }
  }
  return count;
}
