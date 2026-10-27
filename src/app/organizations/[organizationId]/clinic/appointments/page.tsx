import Link from "next/link";
import { organizationContext } from "@/modules/organizations/page-context";
import { listAppointments } from "@/modules/clinic/service";
import { clinicDate, dayRange, displayTime } from "@/modules/clinic/time";
import { ClinicHeader, AppointmentStatusForm } from "@/components/clinic";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/message";
export default async function Appointments({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ day?: string; error?: string }>;
}) {
  const { organizationId: org } = await params;
  const { user, role } = await organizationContext(org);
  const query = await searchParams,
    day = query.day ?? clinicDate();
  let valid = true;
  try {
    dayRange(day);
  } catch {
    valid = false;
  }
  const appointments = valid ? await listAppointments(user.id, org, day) : [];
  return (
    <>
      <ClinicHeader
        org={org}
        title="Appointment agenda"
        description="Book from a lead record. View appointments overlapping the selected clinic day in IST; up to 100 entries."
      />
      <Message error={query.error} />
      <Card>
        <CardHeader>
          <CardTitle>Clinic day</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <form method="get" className="flex items-end gap-3">
            <label>
              Date (IST)
              <Input name="day" type="date" defaultValue={day} required />
            </label>
            <Button variant="outline">View day</Button>
          </form>
          {!valid && <Message error="Choose a valid clinic date." />}
          <ul className="divide-y">
            {appointments.map((a) => (
              <li key={a.id} className="space-y-3 py-4">
                <div className="flex flex-wrap justify-between gap-3">
                  <div>
                    <Link
                      className="font-medium text-primary underline"
                      href={`/organizations/${org}/clinic/leads/${a.leadId}`}
                    >
                      {a.lead.name}
                    </Link>
                    <p className="mt-1 text-sm">
                      {displayTime(a.startsAt)} – {displayTime(a.endsAt)} ·{" "}
                      {a.resource}
                    </p>
                  </div>
                  <p className="text-sm lowercase">
                    {a.status.replaceAll("_", " ")}
                  </p>
                </div>
                {role !== "MEMBER" && (
                  <AppointmentStatusForm org={org} appointment={a} />
                )}
              </li>
            ))}
          </ul>
          {valid && !appointments.length && (
            <p className="text-sm text-muted-foreground">
              No appointments for this day.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
