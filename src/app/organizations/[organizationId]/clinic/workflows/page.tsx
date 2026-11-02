import { organizationContext } from "@/modules/organizations/page-context";
import { ClinicHeader } from "@/components/clinic";
import { AIWorkflowTriggerPanel } from "@/components/ai-workflow-trigger-panel";
import { getTenantWorkflowProposals } from "@/modules/workflows/ai-triggers";

export default async function ClinicWorkflowsPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId: org } = await params;
  await organizationContext(org, "clinic");
  const proposals = getTenantWorkflowProposals(org);

  return (
    <div className="space-y-6">
      <ClinicHeader
        org={org}
        title="AI Workflow Automation"
        description="Automated clinical and patient lifecycle intelligence powered by @google/genai (gemini-3.8-flash) with strict human-in-the-loop audit compliance."
      />

      <AIWorkflowTriggerPanel organizationId={org} initialProposals={proposals} />
    </div>
  );
}
