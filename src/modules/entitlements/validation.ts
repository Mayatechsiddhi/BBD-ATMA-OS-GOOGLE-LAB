import { z } from "zod";
import { modules } from "@/modules/registry";

export const entitlementInput = z.strictObject({
  moduleId: z.enum(modules.map((module) => module.id)),
  enabled: z.boolean(),
  version: z.number().int().min(0).max(2147483646),
});
export class EntitlementConflict extends Error {
  constructor() {
    super("Module access changed. Reload and try again.");
  }
}
