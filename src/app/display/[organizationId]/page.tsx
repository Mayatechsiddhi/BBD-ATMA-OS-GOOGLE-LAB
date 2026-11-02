import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { board } from "@/modules/calling/service";
import { AccessError } from "@/modules/organizations/policy";
import { LiveTokenTvDisplay } from "@/components/live-token-tv-display";

export default async function Display({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  const { user } = await requireSession();
  // No staff/patient data or account name is embedded in the waiting-room page.
  await board(user.id, organizationId).catch((e) => {
    if (e instanceof AccessError) notFound();
    throw e;
  });

  return <LiveTokenTvDisplay org={organizationId} orgName="BBD Clinic TV Display" />;
}
