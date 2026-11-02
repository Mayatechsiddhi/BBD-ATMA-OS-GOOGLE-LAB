import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  runTenantWorkerCycle,
  dispatchWorkflowDomainEvent,
  setTenantWorkerState,
  getTenantWorkerMetrics,
  getTenantRecentTasks,
} from "@/modules/workflows/worker-orchestrator";

export async function POST(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user) {
      // In production, also support trusted server gateway header (e.g. cron worker)
      const proxySecret = req.headers.get("x-auth-proxy-secret");
      if (!proxySecret || proxySecret !== process.env.AUTH_PROXY_SECRET) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const body = await req.json();
    const { action, organizationId, payload, state } = body;

    if (!organizationId) {
      return NextResponse.json({ error: "Missing organizationId" }, { status: 400 });
    }

    if (action === "RUN_CYCLE") {
      const result = await runTenantWorkerCycle(organizationId, 10);
      return NextResponse.json({ success: true, ...result });
    }

    if (action === "DISPATCH_EVENT") {
      const eventType = body.eventType || "clinic.lead.created";
      const tasks = await dispatchWorkflowDomainEvent(organizationId, eventType, payload || {});
      return NextResponse.json({ success: true, tasksCount: tasks.length });
    }

    if (action === "TOGGLE_STATE" && (state === "ACTIVE" || state === "PAUSED")) {
      const newState = setTenantWorkerState(organizationId, state);
      return NextResponse.json({ success: true, state: newState });
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

    const metrics = getTenantWorkerMetrics(orgId);
    const tasks = getTenantRecentTasks(orgId, 25);
    return NextResponse.json({ metrics, tasks });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 },
    );
  }
}
