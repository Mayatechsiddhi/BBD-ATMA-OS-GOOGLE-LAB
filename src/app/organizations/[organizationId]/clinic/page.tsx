import Link from "next/link";
import { organizationContext } from "@/modules/organizations/page-context";
import { dashboard } from "@/modules/clinic/service";
import { displayTime } from "@/modules/clinic/time";
import { ClinicHeader } from "@/components/clinic";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
export default async function ClinicDashboard({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId: org } = await params;
  const { user } = await organizationContext(org);
  const data = await dashboard(user.id, org);
  const base = `/organizations/${org}/clinic`;
  const active = data.leads
    .filter((g) => !["CONVERTED", "LOST"].includes(g.status))
    .reduce((n, g) => n + g._count._all, 0);
  return (
    <>
      <ClinicHeader
        org={org}
        title="Clinic dashboard"
        description="Live lead, appointment and follow-up activity for this organization. All times are IST (Asia/Kolkata)."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Active leads", active],
          ["Appointments today", data.appointmentsToday],
          ["Open follow-ups", data.openFollowUps],
          ["Overdue follow-ups", data.overdueFollowUps],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardHeader>
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="text-3xl font-semibold">{value}</p>
            </CardHeader>
          </Card>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Lead pipeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.leads.length ? (
              data.leads.map((g) => (
                <Link
                  className="flex justify-between text-sm text-primary underline"
                  key={g.status}
                  href={`${base}/leads?status=${g.status}`}
                >
                  <span>{g.status.toLowerCase()}</span>
                  <span>{g._count._all}</span>
                </Link>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No clinic leads yet. Start by adding a lead.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Next appointments</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {data.upcoming.map((a) => (
                <li key={a.id} className="space-y-1 py-3 text-sm">
                  <Link
                    className="text-primary underline"
                    href={`${base}/leads/${a.leadId}`}
                  >
                    {a.lead.name}
                  </Link>
                  <p>
                    {displayTime(a.startsAt)} · {a.resource}
                  </p>
                </li>
              ))}
            </ul>
            {!data.upcoming.length && (
              <p className="text-sm text-muted-foreground">
                No upcoming appointments.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
