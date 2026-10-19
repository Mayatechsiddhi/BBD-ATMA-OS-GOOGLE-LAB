import type { Role } from "@/generated/prisma/client";
export type Permission =
  "read" | "settings" | "invite" | "members" | "crm:write";
export class AccessError extends Error {
  constructor() {
    super("Access denied");
  }
}
const permissions: Record<Role, readonly Permission[]> = {
  OWNER: ["read", "settings", "invite", "members", "crm:write"],
  ADMIN: ["read", "settings", "invite", "crm:write"],
  MEMBER: ["read"],
};
export function authorize(role: Role | undefined, permission: Permission) {
  if (!role || !permissions[role]?.includes(permission))
    throw new AccessError();
}
