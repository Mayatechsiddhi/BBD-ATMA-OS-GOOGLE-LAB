// Architectural boundaries only. Entries do not imply implemented capabilities.
export const modules = [
  {
    id: "atma",
    name: "ATMA intelligence",
    description:
      "Tenant-scoped context, model policies and auditable inference.",
  },
  {
    id: "agents",
    name: "AI agents",
    description: "Permission-bound execution with human approval checkpoints.",
  },
  {
    id: "workflows",
    name: "Workflows",
    description: "Durable orchestration, retries and explicit business events.",
  },
  {
    id: "marketing",
    name: "Marketing",
    description: "Consent-aware audiences, campaigns and delivery adapters.",
  },
  {
    id: "industry",
    name: "Industry operating systems",
    description:
      "Reusable domain packages composed from platform capabilities.",
  },
] as const;
