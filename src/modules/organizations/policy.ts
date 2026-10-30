import type { Role } from "@/generated/prisma/client";
export type Permission =
  | "modules:manage"
  | "display:read"
  | "read"
  | "settings"
  | "invite"
  | "members"
  | "crm:write";
export class AccessError extends Error {
  constructor() {
    super("Access denied");
  }
}
const permissions: Record<Role, readonly Permission[]> = {
  DISPLAY: ["display:read"],
  OWNER: [
    "modules:manage",
    "display:read",
    "read",
    "settings",
    "invite",
    "members",
    "crm:write",
  ],
  ADMIN: ["display:read", "read", "settings", "invite", "crm:write"],
  MEMBER: ["display:read", "read"],
};
export function authorize(role: Role | undefined, permission: Permission) {
  if (!role || !permissions[role]?.includes(permission))
    throw new AccessError();
}
