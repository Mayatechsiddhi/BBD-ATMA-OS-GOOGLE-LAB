import type { Role } from "@/generated/prisma/client";
export type Permission =
  | "events:read"
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
    "events:read",
    "modules:manage",
    "display:read",
    "read",
    "settings",
    "invite",
    "members",
    "crm:write",
  ],
  ADMIN: [
    "events:read",
    "display:read",
    "read",
    "settings",
    "invite",
    "crm:write",
  ],
  MEMBER: ["display:read", "read"],
};
export function authorize(role: Role | undefined, permission: Permission) {
  if (!role || !permissions[role]?.includes(permission))
    throw new AccessError();
}
