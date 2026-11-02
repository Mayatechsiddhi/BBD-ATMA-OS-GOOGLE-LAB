import Link from "next/link";
import {
  Building2,
  LayoutDashboard,
  Users,
  Settings,
  Layers3,
  ContactRound,
  Tv,
  QrCode,
} from "lucide-react";
import { organizationContext } from "@/modules/organizations/page-context";
import { signOut } from "@/app/actions";
import { Button } from "@/components/ui/button";
export default async function OrganizationLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  const { organization, role, user } =
    await organizationContext(organizationId);
  const base = `/organizations/${organizationId}`;
  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside className="border-r bg-[#102e2c] p-6 text-white">
        <Link
          href="/organizations"
          className="flex items-center gap-3 text-lg font-semibold"
        >
          <Building2 className="text-emerald-300" aria-hidden />
          BBD ATMA<span className="sr-only">Organizations</span>
        </Link>
        <p className="mt-1 text-[10px] tracking-[.2em] text-emerald-200">
          MASTER OPERATING SYSTEM
        </p>
        <div className="my-8 rounded-lg border border-white/15 p-3">
          <p className="text-sm font-medium">{organization.name}</p>
          <p className="mt-1 text-xs text-emerald-200">
            {role.toLowerCase()} workspace
          </p>
        </div>
        <nav aria-label="Workspace" className="space-y-2 text-sm">
          {[
            ["", LayoutDashboard, "Overview"],
            ["/members", Users, "People & access"],
            ["/settings", Settings, "Organization settings"],
            ["/crm", ContactRound, "Client relationships"],
            ["/clinic", ContactRound, "Clinic CRM"],
            ["/clinic/billing", QrCode, "0% UPI Billing"],
            ["/modules", Layers3, "Platform modules"],
          ].map(([path, Icon, label]) => {
            const I = Icon as typeof Building2;
            return (
              <Link
                key={String(path)}
                href={base + path}
                className="flex items-center gap-3 rounded-md px-3 py-3 hover:bg-white/10"
              >
                <I size={18} aria-hidden />
                {String(label)}
              </Link>
            );
          })}
          <Link
            href={`/display/${organizationId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-md px-3 py-3 text-emerald-300 hover:bg-white/10"
          >
            <Tv size={18} aria-hidden />
            Live TV Display ↗
          </Link>
        </nav>
        <Link
          href="/organizations"
          className="mt-10 block text-xs text-emerald-200 underline"
        >
          Switch organization
        </Link>
      </aside>
      <div>
        <header className="flex items-center justify-between border-b bg-card px-6 py-4 md:px-10">
          <p className="text-sm text-muted-foreground">
            Workspace / {organization.name}
          </p>
          <div className="flex items-center gap-4">
            <span className="hidden text-sm sm:inline">{user.name}</span>
            <form action={signOut}>
              <Button variant="outline">Sign out</Button>
            </form>
          </div>
        </header>
        <main className="mx-auto max-w-7xl space-y-6 p-6 md:p-10">
          {children}
        </main>
      </div>
    </div>
  );
}
