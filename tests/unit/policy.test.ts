import { describe, it, expect } from "vitest";
import {
  authorize,
  AccessError,
  type Permission,
} from "../../src/modules/organizations/policy";
import type { Role } from "../../src/generated/prisma/enums";
describe("tenant permissions", () => {
  for (const role of [
    "OWNER",
    "ADMIN",
    "MEMBER",
    "DISPLAY",
    undefined,
  ] as const) {
    for (const permission of [
      "modules:manage",
      "display:read",
      "read",
      "settings",
      "invite",
      "members",
      "crm:write",
    ] as Permission[]) {
      const allowed =
        !!role &&
        (permission === "display:read" ||
          (role !== "DISPLAY" &&
            (permission === "read" ||
              role === "OWNER" ||
              (role === "ADMIN" &&
                permission !== "members" &&
                permission !== "modules:manage"))));
      it(`${role ?? "outsider"}: ${permission} ${allowed ? "allowed" : "denied"}`, () => {
        if (allowed)
          expect(() => authorize(role as Role, permission)).not.toThrow();
        else expect(() => authorize(role, permission)).toThrow(AccessError);
      });
    }
  }
});
