import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { AccessError } from "./policy";
import { getOrganization } from "./service";
export async function organizationContext(id: string) {
  const { user } = await requireSession();
  try {
    return { user, ...(await getOrganization(user.id, id)) };
  } catch (e) {
    if (e instanceof AccessError) notFound();
    throw e;
  }
}
