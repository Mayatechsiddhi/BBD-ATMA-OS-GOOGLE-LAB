import type { ContactStatus } from "@/generated/prisma/enums";
export const nextStatuses: Record<ContactStatus, readonly ContactStatus[]> = {
  LEAD: ["QUALIFIED", "ARCHIVED"],
  QUALIFIED: ["CUSTOMER", "ARCHIVED"],
  CUSTOMER: ["ARCHIVED"],
  ARCHIVED: [],
};
export function validateTransition(from: ContactStatus, to: ContactStatus) {
  if (!nextStatuses[from].includes(to))
    throw new Error("Invalid client workflow transition.");
}
