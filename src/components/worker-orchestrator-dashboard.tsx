"use client";

import React, { useState } from "react";
import {
  Cpu,
  Play,
  Pause,
  RotateCcw,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Activity,
  Layers,
  ShieldCheck,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import {
  runWorkerCycleAction,
  toggleWorkerStateAction,
  retryDeadLetterAction,
  simulateDomainEventAction,
} from "@/app/orchestrator-actions";
import type {
  BackgroundWorkerTask,
  WorkerOrchestratorMetrics,
} from "@/modules/workflows/worker-orchestrator";

interface Props {
  organizationId: string;
  initialMetrics: WorkerOrchestratorMetrics;
  initialTasks: BackgroundWorkerTask[];
}

export function WorkerOrchestratorDashboard({
  organizationId,
  initialMetrics,
  initialTasks,
}: Props) {
  const [metrics, setMetrics] = useState<WorkerOrchestratorMetrics>(initialMetrics);
  const [tasks, setTasks] = useState<BackgroundWorkerTask[]>(initialTasks);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const handleRunCycle = async () => {
    setLoading(true);
    setNotice(null);
    try {
      const res = await runWorkerCycleAction(organizationId);
      if (res.success) {
        setNotice(`Worker cycle completed: ${res.processed} processed (${res.succeeded} succeeded, ${res.failed} failed)`);
        // Refresh local tasks status
        setTasks((prev) =>
          prev.map((t) =>
            t.status === "QUEUED"
              ? {
                  ...t,
                  status: "COMPLETED",
                  durationMs: 340,
                  completedAt: new Date().toISOString(),
                }
              : t,
          ),
        );
        setMetrics((prev) => ({
          ...prev,
          totalCompleted: prev.totalCompleted + (res.succeeded || 0),
          queueDepth: Math.max(0, prev.queueDepth - (res.processed || 0)),
        }));
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Cycle failed");
    } finally {
      setLoading(false);
    }
  };

  const handleToggleState = async () => {
    const nextState = metrics.workerState === "ACTIVE" ? "PAUSED" : "ACTIVE";
    setLoading(true);
    try {
      const res = await toggleWorkerStateAction(organizationId, nextState);
      if (res.success && res.state) {
        setMetrics((prev) => ({ ...prev, workerState: res.state! }));
        setNotice(`Worker engine state changed to: ${res.state}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRetryDeadLetters = async () => {
    setLoading(true);
    try {
      const res = await retryDeadLetterAction(organizationId);
      if (res.success) {
        setNotice(`Re-queued ${res.reQueued} dead letter tasks for processing.`);
        setMetrics((prev) => ({
          ...prev,
          totalDeadLetter: 0,
          queueDepth: prev.queueDepth + (res.reQueued || 0),
        }));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSimulateEvent = async (
    eventType: string,
    payload: Record<string, unknown>,
  ) => {
    setLoading(true);
    setNotice(null);
    try {
      const res = await simulateDomainEventAction(organizationId, eventType, payload);
      if (res.success && res.tasks) {
        setTasks((prev) => [...res.tasks!, ...prev]);
        setMetrics((prev) => ({
          ...prev,
          totalEnqueued: prev.totalEnqueued + res.tasks!.length,
          queueDepth: prev.queueDepth + res.tasks!.length,
        }));
        setNotice(`Dispatched domain event "${eventType}" -> ${res.tasks.length} background tasks enqueued.`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="rounded-xl border border-sky-500/20 bg-gradient-to-r from-sky-950/40 via-blue-950/30 to-zinc-950 p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-sky-600/30 text-sky-400 ring-1 ring-sky-500/30">
              <Cpu className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-zinc-100">
                  Background Worker Orchestrator
                </h3>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    metrics.workerState === "ACTIVE"
                      ? "bg-emerald-950/70 text-emerald-300 ring-1 ring-emerald-500/30"
                      : "bg-amber-950/70 text-amber-300 ring-1 ring-amber-500/30"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${metrics.workerState === "ACTIVE" ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
                  Engine: {metrics.workerState}
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Multi-tenant asynchronous event queue, task idempotency, exponential backoff, and dead-letter supervision.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleToggleState}
              disabled={loading}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                metrics.workerState === "ACTIVE"
                  ? "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                  : "bg-emerald-600 text-white hover:bg-emerald-500"
              }`}
            >
              {metrics.workerState === "ACTIVE" ? (
                <>
                  <Pause className="h-3.5 w-3.5" />
                  Pause Engine
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" />
                  Resume Engine
                </>
              )}
            </button>

            <button
              onClick={handleRunCycle}
              disabled={loading || metrics.workerState === "PAUSED"}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-sky-500 disabled:opacity-50"
            >
              {loading ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Zap className="h-3.5 w-3.5" />
              )}
              Run Worker Cycle Now
            </button>

            {metrics.totalDeadLetter > 0 && (
              <button
                onClick={handleRetryDeadLetters}
                disabled={loading}
                className="inline-flex items-center gap-1 rounded-lg bg-rose-600/30 px-3 py-1.5 text-xs font-medium text-rose-300 ring-1 ring-rose-500/30 hover:bg-rose-600/40"
              >
                <RotateCcw className="h-3 w-3" />
                Retry Dead Letter ({metrics.totalDeadLetter})
              </button>
            )}
          </div>
        </div>
      </div>

      {notice && (
        <div className="rounded-lg border border-sky-500/30 bg-sky-950/30 px-4 py-2.5 text-xs text-sky-300">
          {notice}
        </div>
      )}

      {/* Metrics Grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Pending Queue Depth</span>
            <Layers className="h-4 w-4 text-sky-400" />
          </div>
          <p className="mt-2 text-2xl font-bold text-zinc-100">{metrics.queueDepth}</p>
          <p className="mt-1 text-[11px] text-zinc-500">Awaiting worker cycle</p>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Tasks Completed</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          </div>
          <p className="mt-2 text-2xl font-bold text-zinc-100">{metrics.totalCompleted}</p>
          <p className="mt-1 text-[11px] text-emerald-500/90">Successfully executed</p>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Avg Execution Latency</span>
            <TrendingUp className="h-4 w-4 text-purple-400" />
          </div>
          <p className="mt-2 text-2xl font-bold text-zinc-100">{metrics.avgDurationMs}ms</p>
          <p className="mt-1 text-[11px] text-zinc-500">Per handler invocation</p>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Dead-Letter Count</span>
            <AlertTriangle className="h-4 w-4 text-amber-400" />
          </div>
          <p className="mt-2 text-2xl font-bold text-zinc-100">{metrics.totalDeadLetter}</p>
          <p className="mt-1 text-[11px] text-zinc-500">Max retries exceeded (0 active)</p>
        </div>
      </div>

      {/* Domain Event Simulator */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <div className="flex flex-col gap-1 pb-3">
          <h4 className="text-sm font-semibold text-zinc-200">
            Domain Event Simulator (Multi-Tenant Outbox Triggers)
          </h4>
          <p className="text-xs text-zinc-400">
            Click to dispatch automated clinical & financial domain events into the worker orchestration pipeline:
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <button
            onClick={() =>
              handleSimulateEvent("clinic.lead.created", {
                leadId: `lead_sim_${Date.now()}`,
                name: "Kavita Rao",
                phone: "+91 91234 56789",
                treatmentInterest: "Orthodontic Aligners & Smile Design",
                source: "Website Direct",
              })
            }
            disabled={loading}
            className="flex flex-col items-start rounded-lg border border-zinc-800 bg-zinc-950/80 p-3 text-left transition hover:border-sky-500/40 hover:bg-zinc-900/50"
          >
            <span className="text-xs font-semibold text-zinc-200">1. Lead Inflow</span>
            <span className="text-[11px] text-zinc-400">clinic.lead.created</span>
            <span className="mt-1 text-[10px] text-sky-400">Enqueues AI Lead Enrichment</span>
          </button>

          <button
            onClick={() =>
              handleSimulateEvent("clinic.appointment.booked", {
                appointmentId: `apt_sim_${Date.now()}`,
                patientName: "Aditya Verma",
                doctorName: "Dr. R. K. Verma",
                startsAt: new Date(Date.now() + 86400000).toISOString(),
                clinicalNotes: "Dental root canal completion and crown placement.",
              })
            }
            disabled={loading}
            className="flex flex-col items-start rounded-lg border border-zinc-800 bg-zinc-950/80 p-3 text-left transition hover:border-sky-500/40 hover:bg-zinc-900/50"
          >
            <span className="text-xs font-semibold text-zinc-200">2. Appointment Booked</span>
            <span className="text-[11px] text-zinc-400">clinic.appointment.booked</span>
            <span className="mt-1 text-[10px] text-purple-400">Enqueues Care Plan Protocol</span>
          </button>

          <button
            onClick={() =>
              handleSimulateEvent("clinic.queue.token_called", {
                tokenNumber: 105,
                patientName: "Pooja Hegde",
                doctorName: "Dr. R. K. Verma",
                room: "Room 102 (OPD-A)",
              })
            }
            disabled={loading}
            className="flex flex-col items-start rounded-lg border border-zinc-800 bg-zinc-950/80 p-3 text-left transition hover:border-sky-500/40 hover:bg-zinc-900/50"
          >
            <span className="text-xs font-semibold text-zinc-200">3. Queue Token Called</span>
            <span className="text-[11px] text-zinc-400">clinic.queue.token_called</span>
            <span className="mt-1 text-[10px] text-emerald-400">Broadcasts Live TV & Patient SMS</span>
          </button>

          <button
            onClick={() =>
              handleSimulateEvent("clinic.billing.payment_settled", {
                invoiceId: `inv_sim_${Date.now()}`,
                paymentLinkId: `pay_sim_${Date.now()}`,
                amountPaise: 450000,
                gateway: "DIRECT_UPI_QR",
                transactionRef: `upi_ref_${Date.now()}`,
                settledAt: new Date().toISOString(),
              })
            }
            disabled={loading}
            className="flex flex-col items-start rounded-lg border border-zinc-800 bg-zinc-950/80 p-3 text-left transition hover:border-sky-500/40 hover:bg-zinc-900/50"
          >
            <span className="text-xs font-semibold text-zinc-200">4. Payment Settled</span>
            <span className="text-[11px] text-zinc-400">clinic.billing.payment_settled</span>
            <span className="mt-1 text-[10px] text-amber-400">Reconciles 0%-fee ledger</span>
          </button>
        </div>
      </div>

      {/* Tasks Queue Stream */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-zinc-200">
              Live Asynchronous Task Queue & Execution Log
            </h4>
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
              {tasks.length} tasks
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
            <span>Idempotency Protected</span>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/70">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-zinc-800 bg-zinc-950/60 text-zinc-400">
              <tr>
                <th className="px-4 py-3 font-medium">Task ID</th>
                <th className="px-4 py-3 font-medium">Domain Event</th>
                <th className="px-4 py-3 font-medium">Handler</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Attempts</th>
                <th className="px-4 py-3 font-medium">Latency</th>
                <th className="px-4 py-3 font-medium">Queued At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 text-zinc-300">
              {tasks.map((task) => (
                <tr key={task.id} className="hover:bg-zinc-800/40 transition">
                  <td className="px-4 py-3 font-mono text-zinc-400">{task.id}</td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-sky-950/60 px-2 py-0.5 text-[10px] font-medium text-sky-300 ring-1 ring-sky-500/20">
                      {task.eventType}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-zinc-200">{task.handlerName}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        task.status === "COMPLETED"
                          ? "bg-emerald-950/70 text-emerald-300 ring-1 ring-emerald-500/20"
                          : task.status === "QUEUED"
                            ? "bg-amber-950/70 text-amber-300 ring-1 ring-amber-500/20"
                            : task.status === "RUNNING"
                              ? "bg-sky-950/70 text-sky-300 ring-1 ring-sky-500/20"
                              : "bg-rose-950/70 text-rose-300 ring-1 ring-rose-500/20"
                      }`}
                    >
                      {task.status === "COMPLETED" && <CheckCircle2 className="h-2.5 w-2.5" />}
                      {task.status === "QUEUED" && <Clock className="h-2.5 w-2.5" />}
                      {task.status === "RUNNING" && <Activity className="h-2.5 w-2.5 animate-spin" />}
                      {task.status === "DEAD_LETTER" && <AlertTriangle className="h-2.5 w-2.5" />}
                      {task.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-400">
                    {task.attempts}/{task.maxAttempts}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">
                    {task.durationMs ? `${task.durationMs}ms` : "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-500">
                    {new Date(task.queuedAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
