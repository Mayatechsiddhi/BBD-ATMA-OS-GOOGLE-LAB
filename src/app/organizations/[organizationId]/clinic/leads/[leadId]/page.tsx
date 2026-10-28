import { notFound } from "next/navigation";
import { organizationContext } from "@/modules/organizations/page-context";
import { getLead } from "@/modules/clinic/service";
import { AccessError } from "@/modules/organizations/policy";
import { displayTime } from "@/modules/clinic/time";
import {
  addClinicFollowUp,
  bookClinicAppointment,
  editClinicLead,
  moveClinicAppointment,
} from "@/app/clinic-actions";
import {
  ClinicHeader,
  LeadFields,
  LeadStatusForm,
  AppointmentFields,
  AppointmentStatusForm,
} from "@/components/clinic";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AppointmentSlots } from "@/components/appointment-slots";
export default async function LeadDetail({
  params,
}: {
  params: Promise<{ organizationId: string; leadId: string }>;
}) {
  const { organizationId: org, leadId } = await params;
  const { user, role } = await organizationContext(org);
  const data = await getLead(user.id, org, leadId).catch((e) => {
    if (e instanceof AccessError) notFound();
    throw e;
  });
  const writable = role !== "MEMBER";
  return (
    <>
      <ClinicHeader
        org={org}
        title={data.lead.name}
        description={`Lead status: ${data.lead.status.toLowerCase()} · Administrative contact record · Times in IST`}
      />
      <Card>
        <CardHeader>
          <CardTitle>Contact details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {writable ? (
            <>
              <form
                action={editClinicLead.bind(null, org)}
                className="grid items-end gap-4 md:grid-cols-2"
              >
                <input type="hidden" name="leadId" value={leadId} />
                <LeadFields lead={data.lead} />
                <Button>Save lead details</Button>
              </form>
              <LeadStatusForm org={org} lead={data.lead} />
            </>
          ) : (
            <div className="space-y-2 text-sm">
              <p>{data.lead.phone}</p>
              <p>{data.lead.email ?? "No email recorded"}</p>
              <p>Source: {data.lead.source.toLowerCase()}</p>
            </div>
          )}
        </CardContent>
      </Card>
      {writable && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Book appointment</CardTitle>
            </CardHeader>
            <CardContent>
              {data.lead.status === "LOST" ? (
                <p className="text-sm text-muted-foreground">
                  Lost leads cannot receive new appointments.
                </p>
              ) : (
                <>
                  <AppointmentSlots
                    org={org}
                    leadId={leadId}
                    doctors={data.doctors}
                  />
                  <form
                    action={bookClinicAppointment.bind(null, org)}
                    className="space-y-4"
                  >
                    <input type="hidden" name="leadId" value={leadId} />
                    <AppointmentFields />
                    <p className="text-xs text-muted-foreground">
                      Use a consistent practitioner or room name. Overlaps for
                      that resource or this lead are rejected. Maximum duration:
                      eight hours.
                    </p>
                    <Button>Book appointment</Button>
                  </form>
                </>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Create follow-up</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                action={addClinicFollowUp.bind(null, org)}
                className="space-y-4"
              >
                <input type="hidden" name="leadId" value={leadId} />
                <label>
                  Follow-up task
                  <Input name="title" required minLength={2} maxLength={160} />
                </label>
                <label>
                  Due (IST)
                  <Input name="dueAt" type="datetime-local" required />
                </label>
                <Button>Create follow-up</Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Appointments</CardTitle>
          <p className="text-sm text-muted-foreground">
            Most recent 50 by scheduled start.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {data.appointments.map((a) => (
            <div key={a.id} className="space-y-3 border-b pb-5">
              <p className="text-sm">
                {displayTime(a.startsAt)} – {displayTime(a.endsAt)} ·{" "}
                {a.resource} · {a.status.toLowerCase().replaceAll("_", " ")}
              </p>
              {writable && (
                <>
                  <AppointmentStatusForm org={org} appointment={a} />
                  {["SCHEDULED", "CONFIRMED"].includes(a.status) && (
                    <details>
                      <summary className="cursor-pointer text-sm text-primary">
                        Reschedule appointment
                      </summary>
                      <form
                        action={moveClinicAppointment.bind(null, org)}
                        className="mt-3 grid items-end gap-3 md:grid-cols-3"
                      >
                        <input
                          type="hidden"
                          name="appointmentId"
                          value={a.id}
                        />
                        <AppointmentFields appointment={a} />
                        <Button variant="outline">Save reschedule</Button>
                      </form>
                    </details>
                  )}
                </>
              )}
            </div>
          ))}
          {!data.appointments.length && (
            <p className="text-sm text-muted-foreground">
              No appointments for this lead.
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Follow-up history</CardTitle>
          <p className="text-sm text-muted-foreground">
            Latest 50 by due time. Manage open tasks in Follow-ups.
          </p>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {data.followUps.map((f) => (
              <li key={f.id} className="py-3 text-sm">
                {f.title} · {displayTime(f.dueAt)} · {f.status.toLowerCase()}
              </li>
            ))}
          </ul>
          {!data.followUps.length && (
            <p className="text-sm text-muted-foreground">
              No follow-ups for this lead.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
