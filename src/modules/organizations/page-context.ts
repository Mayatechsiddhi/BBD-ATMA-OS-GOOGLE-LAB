import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { AccessError } from "./policy";
import type { ModuleId } from "@/modules/registry";
import { getOrganization } from "./service";
export async function organizationContext(id: string, moduleId?: ModuleId) {
  const { user } = await requireSession();
  try {
    return { user, ...(await getOrganization(user.id, id, moduleId)) };
  } catch (e) {
    if (e instanceof AccessError) notFound();
    throw e;
  }
}
