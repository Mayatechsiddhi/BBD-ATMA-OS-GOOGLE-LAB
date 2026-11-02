"use client";

import React, { useState } from "react";
import {
  Sparkles,
  CheckCircle2,
  XCircle,
  Clock,
  Bot,
  Brain,
  ShieldCheck,
  Send,
  RefreshCw,
  Flame,
  Stethoscope,
  Users,
} from "lucide-react";
import {
  triggerLeadAIAction,
  triggerFollowUpAIAction,
  triggerReceptionTriageAIAction,
  decideWorkflowProposalAction,
} from "@/app/workflow-actions";
import type { AIWorkflowProposal } from "@/modules/workflows/ai-triggers";

interface Props {
  organizationId: string;
  initialProposals?: AIWorkflowProposal[];
}

export function AIWorkflowTriggerPanel({ organizationId, initialProposals = [] }: Props) {
  const [activeTab, setActiveTab] = useState<"lead" | "followup" | "triage">("lead");
  const [proposals, setProposals] = useState<AIWorkflowProposal[]>(initialProposals);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Lead Form State
  const [leadName, setLeadName] = useState("Vikram Malhotra");
  const [leadPhone, setLeadPhone] = useState("+91 98765 43210");
  const [leadInterest, setLeadInterest] = useState("Dental Implants & Smile Design");
  const [leadSource, setLeadSource] = useState("Instagram Campaign / Direct Inquiry");

  // Follow-Up Form State
  const [patName, setPatName] = useState("Ananya Sharma");
  const [docName, setDocName] = useState("Dr. R. K. Verma (Dental Surgeon)");
  const [clinicalNotes, setClinicalNotes] = useState("Post-extraction molar socket dressing. Prescribed Amoxicillin & Ibuprofen.");

  // Triage State
  const [triageToken, setTriageToken] = useState("104");
  const [triagePat, setTriagePat] = useState("Rajesh Kumar");
  const [triageWait, setTriageWait] = useState("35");
  const [triageSymptoms, setTriageSymptoms] = useState("Acute persistent abdominal discomfort and mild dizziness");

  const handleTriggerLead = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const res = await triggerLeadAIAction(
        organizationId,
        `lead_${Date.now()}`,
        leadName,
        leadPhone,
        leadInterest,
        leadSource,
      );
      if (res.success && res.proposal) {
        setProposals((prev) => [res.proposal!, ...prev]);
      } else {
        setErrorMsg(res.error || "Failed to trigger AI workflow");
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Error triggering AI workflow");
    } finally {
      setLoading(false);
    }
  };

  const handleTriggerFollowUp = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const res = await triggerFollowUpAIAction(
        organizationId,
        `apt_${Date.now()}`,
        patName,
        docName,
        new Date().toISOString(),
        clinicalNotes,
      );
      if (res.success && res.proposal) {
        setProposals((prev) => [res.proposal!, ...prev]);
      } else {
        setErrorMsg(res.error || "Failed to trigger AI workflow");
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Error triggering AI workflow");
    } finally {
      setLoading(false);
    }
  };

  const handleTriggerTriage = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const res = await triggerReceptionTriageAIAction(
        organizationId,
        parseInt(triageToken) || 1,
        triagePat,
        "Dr. R. K. Verma",
        parseInt(triageWait) || 10,
        triageSymptoms,
      );
      if (res.success && res.proposal) {
        setProposals((prev) => [res.proposal!, ...prev]);
      } else {
        setErrorMsg(res.error || "Failed to trigger AI workflow");
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Error triggering AI workflow");
    } finally {
      setLoading(false);
    }
  };

  const handleDecision = async (proposalId: string, decision: "APPROVED" | "REJECTED") => {
    try {
      const res = await decideWorkflowProposalAction(organizationId, proposalId, decision);
      if (res.success && res.proposal) {
        setProposals((prev) =>
          prev.map((p) => (p.id === proposalId ? res.proposal! : p)),
        );
      }
    } catch (e) {
      console.error("Decision failed", e);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="rounded-xl border border-indigo-500/20 bg-gradient-to-r from-indigo-950/40 via-purple-950/30 to-zinc-950 p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-indigo-600/30 text-indigo-400 ring-1 ring-indigo-500/30">
              <Sparkles className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-zinc-100">
                  @google/genai Automated Workflow Triggers
                </h3>
                <span className="rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-xs font-medium text-indigo-300 ring-1 ring-indigo-500/40">
                  gemini-3.8-flash
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Tenant-authorized clinical intelligence triggers with mandatory human-in-the-loop review.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-950/20 px-3 py-1.5 text-xs text-emerald-400">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            <span>Zero-Token-Leakage Sandbox</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-800">
        <button
          onClick={() => setActiveTab("lead")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === "lead"
              ? "border-indigo-500 text-indigo-400"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Flame className="h-4 w-4" />
          Lead Intake & Conversion
        </button>
        <button
          onClick={() => setActiveTab("followup")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === "followup"
              ? "border-indigo-500 text-indigo-400"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Stethoscope className="h-4 w-4" />
          Post-Care Follow-Up
        </button>
        <button
          onClick={() => setActiveTab("triage")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === "triage"
              ? "border-indigo-500 text-indigo-400"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Users className="h-4 w-4" />
          Reception Queue Triage
        </button>
      </div>

      {errorMsg && (
        <div className="rounded-lg border border-red-500/30 bg-red-950/30 p-3 text-xs text-red-400">
          {errorMsg}
        </div>
      )}

      {/* Tab Panels */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        {activeTab === "lead" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-medium text-zinc-200">
                  AI Lead Qualification & Strategy Generator
                </h4>
                <p className="text-xs text-zinc-400">
                  Evaluates patient lead intent, calculates conversion likelihood, and formats conversational outreach.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-zinc-400">Lead Patient Name</label>
                <input
                  type="text"
                  value={leadName}
                  onChange={(e) => setLeadName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-400">Contact Number</label>
                <input
                  type="text"
                  value={leadPhone}
                  onChange={(e) => setLeadPhone(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-400">Clinical Treatment Interest</label>
                <input
                  type="text"
                  value={leadInterest}
                  onChange={(e) => setLeadInterest(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-400">Inquiry Channel / Source</label>
                <input
                  type="text"
                  value={leadSource}
                  onChange={(e) => setLeadSource(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            <button
              onClick={handleTriggerLead}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Generating Intelligence...
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  Trigger AI Qualification & Draft Script
                </>
              )}
            </button>
          </div>
        )}

        {activeTab === "followup" && (
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium text-zinc-200">
                Post-Care Recall & Bilingual Communication Engine
              </h4>
              <p className="text-xs text-zinc-400">
                Formulates clinical recovery check-in timelines and bilingual patient messages in English & Hindi.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-zinc-400">Patient Name</label>
                <input
                  type="text"
                  value={patName}
                  onChange={(e) => setPatName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-400">Treating Doctor</label>
                <input
                  type="text"
                  value={docName}
                  onChange={(e) => setDocName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-zinc-400">Clinical Treatment & Prescription Notes</label>
                <textarea
                  rows={2}
                  value={clinicalNotes}
                  onChange={(e) => setClinicalNotes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            <button
              onClick={handleTriggerFollowUp}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Generating Follow-Up Protocol...
                </>
              ) : (
                <>
                  <Brain className="h-3.5 w-3.5" />
                  Trigger AI Follow-Up Protocol & Draft
                </>
              )}
            </button>
          </div>
        )}

        {activeTab === "triage" && (
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium text-zinc-200">
                Smart Reception Triage & Queue Advisory
              </h4>
              <p className="text-xs text-zinc-400">
                Calculates clinical acuity, waiting-room advisory notes, and estimated consult duration.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="text-xs font-medium text-zinc-400">Token Number</label>
                <input
                  type="number"
                  value={triageToken}
                  onChange={(e) => setTriageToken(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-400">Patient Name</label>
                <input
                  type="text"
                  value={triagePat}
                  onChange={(e) => setTriagePat(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-400">Wait Duration (Minutes)</label>
                <input
                  type="number"
                  value={triageWait}
                  onChange={(e) => setTriageWait(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="text-xs font-medium text-zinc-400">Chief Symptoms / Reason for Visit</label>
                <input
                  type="text"
                  value={triageSymptoms}
                  onChange={(e) => setTriageSymptoms(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            <button
              onClick={handleTriggerTriage}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Assessing Acuity...
                </>
              ) : (
                <>
                  <Bot className="h-3.5 w-3.5" />
                  Trigger AI Queue Triage
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Generated Workflow Proposals & Review Queue */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-zinc-200">
              AI Workflow Execution & Review Queue
            </h4>
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
              {proposals.length} triggers
            </span>
          </div>
          <p className="text-xs text-zinc-500">
            Side-effects require verified staff approval
          </p>
        </div>

        {proposals.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-xs text-zinc-500">
            No active AI workflow triggers for this organization yet. Click one of the buttons above to trigger your first Gemini intelligence workflow.
          </div>
        ) : (
          <div className="space-y-3">
            {proposals.map((prop) => (
              <div
                key={prop.id}
                className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-4 shadow-sm"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-indigo-950/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-400 ring-1 ring-indigo-500/20">
                        {prop.triggerType.replace(/_/g, " ")}
                      </span>
                      <span className="text-xs font-semibold text-zinc-200">
                        {prop.targetEntityName}
                      </span>
                      <span className="text-[11px] text-zinc-500">
                        Model: {prop.modelUsed}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-300">{prop.summary}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5 pt-1">
                      {prop.recommendations.map((rec, idx) => (
                        <span
                          key={idx}
                          className="rounded-md bg-zinc-800/80 px-2 py-0.5 text-[11px] text-zinc-300"
                        >
                          • {rec}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                        prop.status === "APPROVED"
                          ? "bg-emerald-950/60 text-emerald-400 ring-1 ring-emerald-500/30"
                          : prop.status === "REJECTED"
                            ? "bg-rose-950/60 text-rose-400 ring-1 ring-rose-500/30"
                            : "bg-amber-950/60 text-amber-400 ring-1 ring-amber-500/30"
                      }`}
                    >
                      {prop.status === "APPROVED" && <CheckCircle2 className="h-3 w-3" />}
                      {prop.status === "REJECTED" && <XCircle className="h-3 w-3" />}
                      {prop.status === "PENDING_APPROVAL" && <Clock className="h-3 w-3" />}
                      {prop.status.replace(/_/g, " ")}
                    </span>

                    {prop.status === "PENDING_APPROVAL" && (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleDecision(prop.id, "APPROVED")}
                          className="inline-flex items-center gap-1 rounded bg-emerald-600/20 px-2.5 py-1 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-600/30"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          Approve
                        </button>
                        <button
                          onClick={() => handleDecision(prop.id, "REJECTED")}
                          className="inline-flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                        >
                          <XCircle className="h-3 w-3" />
                          Dismiss
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {prop.draftMessage && (
                  <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-xs">
                    <div className="flex items-center justify-between pb-1 text-[11px] font-medium text-zinc-400">
                      <span className="flex items-center gap-1 text-indigo-400">
                        <Send className="h-3 w-3" />
                        Automated Communication Draft
                      </span>
                      <span>Action: {prop.suggestedAction}</span>
                    </div>
                    <pre className="whitespace-pre-wrap font-sans text-zinc-300 text-xs">
                      {prop.draftMessage}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
