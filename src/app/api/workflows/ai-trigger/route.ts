import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  triggerLeadQualification,
  triggerAppointmentFollowUpAI,
  triggerReceptionTriageAI,
  getTenantWorkflowProposals,
} from "@/modules/workflows/ai-triggers";

export async function POST(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { action, organizationId, payload } = body;

    if (!organizationId) {
      return NextResponse.json({ error: "Missing organizationId" }, { status: 400 });
    }

    if (action === "LEAD_QUALIFICATION") {
      const proposal = await triggerLeadQualification({
        organizationId,
        leadId: payload?.leadId || `lead_${Date.now()}`,
        name: payload?.name || "Prospective Patient",
        phone: payload?.phone || "",
        treatmentInterest: payload?.treatmentInterest,
        source: payload?.source,
        estimatedBudget: payload?.estimatedBudget,
      });
      return NextResponse.json({ success: true, proposal });
    }

    if (action === "APPOINTMENT_FOLLOWUP") {
      const proposal = await triggerAppointmentFollowUpAI({
        organizationId,
        appointmentId: payload?.appointmentId || `apt_${Date.now()}`,
        patientName: payload?.patientName || "Patient",
        doctorName: payload?.doctorName || "Doctor",
        appointmentTime: payload?.appointmentTime || new Date().toISOString(),
        clinicalNotes: payload?.clinicalNotes,
      });
      return NextResponse.json({ success: true, proposal });
    }

    if (action === "RECEPTION_TRIAGE") {
      const proposal = await triggerReceptionTriageAI({
        organizationId,
        tokenNumber: payload?.tokenNumber || 1,
        patientName: payload?.patientName || "Walk-In Patient",
        doctorName: payload?.doctorName || "On-Duty Specialist",
        waitingMinutes: payload?.waitingMinutes || 5,
        symptoms: payload?.symptoms,
      });
      return NextResponse.json({ success: true, proposal });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get("organizationId");
    if (!orgId) {
      return NextResponse.json({ error: "Missing organizationId" }, { status: 400 });
    }

    const proposals = getTenantWorkflowProposals(orgId);
    return NextResponse.json({ proposals });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 },
    );
  }
}
