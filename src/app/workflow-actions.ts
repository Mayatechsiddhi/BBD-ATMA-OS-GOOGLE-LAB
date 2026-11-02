"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { logger } from "@/lib/logger";
import {
  triggerLeadQualification,
  triggerAppointmentFollowUpAI,
  triggerReceptionTriageAI,
  updateWorkflowProposalStatus,
  getTenantWorkflowProposals,
  type AIWorkflowProposal,
} from "@/modules/workflows/ai-triggers";

export async function triggerLeadAIAction(
  org: string,
  leadId: string,
  leadName: string,
  leadPhone: string,
  treatmentInterest?: string,
  source?: string,
) {
  const { user } = await requireSession();
  try {
    const proposal = await triggerLeadQualification({
      organizationId: org,
      leadId,
      name: leadName,
      phone: leadPhone,
      treatmentInterest,
      source,
    });
    logger.info({
      event: "workflow.ai.lead_qualification.triggered",
      actorId: user.id,
      organizationId: org,
      proposalId: proposal.id,
    });
    revalidatePath(`/organizations/${org}/clinic/leads`);
    return { success: true, proposal };
  } catch (error) {
    logger.error({
      event: "workflow.ai.trigger.failed",
      error: error instanceof Error ? error.message : "unknown",
    });
    return { success: false, error: "Failed to trigger AI lead analysis" };
  }
}

export async function triggerFollowUpAIAction(
  org: string,
  appointmentId: string,
  patientName: string,
  doctorName: string,
  appointmentTime: string,
  clinicalNotes?: string,
) {
  const { user } = await requireSession();
  try {
    const proposal = await triggerAppointmentFollowUpAI({
      organizationId: org,
      appointmentId,
      patientName,
      doctorName,
      appointmentTime,
      clinicalNotes,
    });
    logger.info({
      event: "workflow.ai.followup.triggered",
      actorId: user.id,
      organizationId: org,
      proposalId: proposal.id,
    });
    revalidatePath(`/organizations/${org}/clinic/follow-ups`);
    return { success: true, proposal };
  } catch (error) {
    logger.error({
      event: "workflow.ai.trigger.failed",
      error: error instanceof Error ? error.message : "unknown",
    });
    return { success: false, error: "Failed to trigger AI follow-up plan" };
  }
}

export async function triggerReceptionTriageAIAction(
  org: string,
  tokenNumber: number,
  patientName: string,
  doctorName: string,
  waitingMinutes: number,
  symptoms?: string,
) {
  const { user } = await requireSession();
  try {
    const proposal = await triggerReceptionTriageAI({
      organizationId: org,
      tokenNumber,
      patientName,
      doctorName,
      waitingMinutes,
      symptoms,
    });
    logger.info({
      event: "workflow.ai.reception_triage.triggered",
      actorId: user.id,
      organizationId: org,
      proposalId: proposal.id,
    });
    revalidatePath(`/organizations/${org}/clinic/reception`);
    return { success: true, proposal };
  } catch (error) {
    logger.error({
      event: "workflow.ai.trigger.failed",
      error: error instanceof Error ? error.message : "unknown",
    });
    return { success: false, error: "Failed to trigger AI reception triage" };
  }
}

export async function decideWorkflowProposalAction(
  org: string,
  proposalId: string,
  decision: "APPROVED" | "REJECTED",
) {
  const { user } = await requireSession();
  const updated = updateWorkflowProposalStatus(org, proposalId, decision, user.id);
  if (!updated) {
    return { success: false, error: "Proposal not found or unauthorized" };
  }
  logger.info({
    event: "workflow.ai.proposal.decided",
    actorId: user.id,
    organizationId: org,
    proposalId,
    decision,
  });
  revalidatePath(`/organizations/${org}`, "layout");
  return { success: true, proposal: updated };
}

export async function fetchOrgWorkflowProposalsAction(org: string): Promise<AIWorkflowProposal[]> {
  await requireSession();
  return getTenantWorkflowProposals(org);
}
