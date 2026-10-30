// Reviewed deployment catalog. An entitlement never makes planned code available.
export const modules = [
  {
    id: "crm",
    name: "Client relationships",
    description: "Contacts and opportunities using the existing CRM services.",
    available: true,
  },
  {
    id: "clinic",
    name: "Clinic OS",
    description:
      "Leads, appointments, follow-ups, schedules and doctor calling.",
    available: true,
  },
  {
    id: "atma",
    available: false,
    name: "ATMA intelligence",
    description:
      "Tenant-scoped context, model policies and auditable inference.",
  },
  {
    id: "agents",
    available: false,
    name: "AI agents",
    description: "Permission-bound execution with human approval checkpoints.",
  },
  {
    id: "workflows",
    available: false,
    name: "Workflows",
    description: "Durable orchestration, retries and explicit business events.",
  },
  {
    id: "marketing",
    available: false,
    name: "Marketing",
    description: "Consent-aware audiences, campaigns and delivery adapters.",
  },
  {
    id: "industry",
    available: false,
    name: "Industry operating systems",
    description:
      "Reusable domain packages composed from platform capabilities.",
  },
] as const;

export type ModuleId = (typeof modules)[number]["id"];
export function moduleAvailable(id: string) {
  return modules.some((module) => module.id === id && module.available);
}
// Preserve current product access on organization creation and migration only.
// Missing rows are denied; future registry entries are never automatically granted.
export const initialModuleIds = [
  "crm",
  "clinic",
] as const satisfies readonly ModuleId[];
