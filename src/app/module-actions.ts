"use server";
import { z, ZodError } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { logger } from "@/lib/logger";
import { AccessError } from "@/modules/organizations/policy";
import { changeEntitlement } from "@/modules/entitlements/service";
import { EntitlementConflict } from "@/modules/entitlements/validation";

export async function updateModuleAccess(
  organizationId: string,
  form: FormData,
) {
  const { user } = await requireSession();
  let error = "";
  try {
    await changeEntitlement(user.id, organizationId, {
      moduleId: form.get("moduleId"),
      enabled: z.enum(["true", "false"]).parse(form.get("enabled")) === "true",
      version: z.coerce.number().parse(form.get("version")),
    });
  } catch (e) {
    if (e instanceof AccessError) error = "Access denied.";
    else if (e instanceof EntitlementConflict) error = e.message;
    else if (e instanceof ZodError) error = "Check the module access form.";
    else {
      error = "Module access could not be saved.";
      logger.error({
        event: "module.access.failed",
        errorType: e instanceof Error ? e.name : "unknown",
      });
    }
  }
  const base = `/organizations/${encodeURIComponent(organizationId)}`;
  revalidatePath(base, "layout");
  redirect(
    `${base}/modules${error ? `?error=${encodeURIComponent(error)}` : ""}`,
  );
}
