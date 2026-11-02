import { organizationContext } from "@/modules/organizations/page-context";
import { ClinicHeader } from "@/components/clinic";
import { WorkerOrchestratorDashboard } from "@/components/worker-orchestrator-dashboard";
import {
  getTenantWorkerMetrics,
  getTenantRecentTasks,
} from "@/modules/workflows/worker-orchestrator";

export default async function ClinicOrchestratorPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId: org } = await params;
  await organizationContext(org, "clinic");

  const metrics = getTenantWorkerMetrics(org);
  const tasks = getTenantRecentTasks(org, 30);

  return (
    <div className="space-y-6">
      <ClinicHeader
        org={org}
        title="Background Worker Orchestrator"
        description="Multi-tenant asynchronous domain event triggers, task execution queues, circuit-breaker retries, and dead-letter supervision."
      />

      <WorkerOrchestratorDashboard
        organizationId={org}
        initialMetrics={metrics}
        initialTasks={tasks}
      />
    </div>
  );
}
