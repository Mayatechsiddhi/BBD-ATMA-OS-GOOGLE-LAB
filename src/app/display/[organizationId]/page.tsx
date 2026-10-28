import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { board } from "@/modules/calling/service";
import { AccessError } from "@/modules/organizations/policy";
import { CallingLive } from "@/components/calling-live";
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
  return (
    <main className="min-h-screen space-y-8 bg-[#102e2c] p-6 text-white md:p-12">
      <header>
        <p className="text-sm uppercase tracking-widest text-emerald-200">
          BBD Clinic
        </p>
        <h1 className="mt-3 text-4xl font-semibold">Doctor calling display</h1>
        <p className="mt-3">
          Please proceed when your token is called. No patient names are
          displayed.
        </p>
      </header>
      <CallingLive org={organizationId} display />
    </main>
  );
}
