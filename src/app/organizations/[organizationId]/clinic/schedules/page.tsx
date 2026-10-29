import { organizationContext } from "@/modules/organizations/page-context";
import { doctorSchedules } from "@/modules/clinic/schedule-service";
import {
  saveDoctorHours,
  addDoctorLeave,
  removeDoctorLeave,
} from "@/app/schedule-actions";
import { ClinicHeader } from "@/components/clinic";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/message";
import { scheduleEndPattern } from "@/modules/clinic/schedule";
const names = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const clock = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export default async function Schedules({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { organizationId: org } = await params;
  const { user, role } = await organizationContext(org);
  const doctors = await doctorSchedules(user.id, org);
  const query = await searchParams;
  const writable = role === "OWNER" || role === "ADMIN";
  return (
    <>
      <ClinicHeader
        org={org}
        title="Doctor schedules"
        description="Weekly working hours, one optional break per day, full-day leave and fixed appointment duration. All times are IST."
      />
      <Message error={query.error} />
      {query.saved && <p role="status">Schedule saved.</p>}
      {!doctors.length && <p>Add a doctor in Reception first.</p>}
      <p className="text-sm text-muted-foreground">
        Saving hours activates schedule enforcement. Unchecked days are closed.
        Changes conflicting with active appointments are rejected; existing
        appointments are never moved or cancelled automatically. Existing
        durations are preserved, while new bookings and reschedules use the
        saved duration.
      </p>
      {doctors.map((d) => (
        <Card key={d.id}>
          <CardHeader>
            <CardTitle>
              {d.name} · {d.room}
            </CardTitle>
            <p>
              {d.schedule
                ? "Configured"
                : "Not configured — existing manual/resource booking remains available"}
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            {writable ? (
              <form
                action={saveDoctorHours.bind(null, org)}
                className="space-y-4"
              >
                <input type="hidden" name="doctorId" value={d.id} />
                <input type="hidden" name="version" value={d.scheduleVersion} />
                <label>
                  Appointment duration (minutes)
                  <Input
                    name="duration"
                    type="number"
                    min={15}
                    max={480}
                    step={15}
                    defaultValue={d.schedule?.duration ?? 30}
                    required
                  />
                </label>
                {names.map((name, weekday) => {
                  const rule = d.schedule?.weekly.find(
                    (r) => r.weekday === weekday,
                  );
                  return (
                    <fieldset
                      key={weekday}
                      className="grid gap-3 rounded-md border p-3 sm:grid-cols-2"
                    >
                      <legend>{name}</legend>
                      <label className="sm:col-span-2">
                        <input
                          type="checkbox"
                          name={`open${weekday}`}
                          defaultChecked={
                            d.schedule ? !!rule : weekday >= 1 && weekday <= 5
                          }
                        />{" "}
                        Open
                      </label>
                      <label>
                        Start (IST)
                        <Input
                          name={`start${weekday}`}
                          type="time"
                          step={900}
                          defaultValue={clock(rule?.start ?? 540)}
                        />
                      </label>
                      <label>
                        End (IST)
                        <Input
                          name={`end${weekday}`}
                          type="text"
                          pattern={scheduleEndPattern}
                          placeholder="HH:MM; 24:00 for end of day"
                          maxLength={5}
                          defaultValue={clock(rule?.end ?? 1020)}
                        />
                      </label>
                      <label>
                        Break start (optional)
                        <Input
                          name={`breakStart${weekday}`}
                          type="time"
                          step={900}
                          defaultValue={
                            rule?.breakStart != null
                              ? clock(rule.breakStart)
                              : ""
                          }
                        />
                      </label>
                      <label>
                        Break end (optional)
                        <Input
                          name={`breakEnd${weekday}`}
                          type="text"
                          pattern={scheduleEndPattern}
                          placeholder="HH:MM; 24:00 for end of day"
                          maxLength={5}
                          defaultValue={
                            rule?.breakEnd != null ? clock(rule.breakEnd) : ""
                          }
                        />
                      </label>
                    </fieldset>
                  );
                })}
                <Button>Save working hours</Button>
              </form>
            ) : (
              <div>
                <p>
                  Appointment duration:{" "}
                  {d.schedule?.duration ?? "Not configured"} minutes
                </p>
                <ul>
                  {d.schedule?.weekly.map((r) => (
                    <li key={r.weekday}>
                      {names[r.weekday]}: {clock(r.start)}–{clock(r.end)}
                      {r.breakStart != null
                        ? ` · Break ${clock(r.breakStart)}–${clock(r.breakEnd!)}`
                        : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <h3 className="font-medium">Full-day leave</h3>
            <ul className="space-y-2">
              {d.schedule?.leave.map((day) => (
                <li key={day} className="flex flex-wrap gap-3">
                  <span>{day}</span>
                  {writable && (
                    <form action={removeDoctorLeave.bind(null, org)}>
                      <input type="hidden" name="doctorId" value={d.id} />
                      <input
                        type="hidden"
                        name="version"
                        value={d.scheduleVersion}
                      />
                      <input type="hidden" name="day" value={day} />
                      <Button variant="outline">Remove leave {day}</Button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
            {!d.schedule?.leave.length && <p>No leave recorded.</p>}
            {writable && d.schedule && (
              <form
                action={addDoctorLeave.bind(null, org)}
                className="flex flex-wrap items-end gap-3"
              >
                <input type="hidden" name="doctorId" value={d.id} />
                <input type="hidden" name="version" value={d.scheduleVersion} />
                <label>
                  Leave date (IST)
                  <Input name="day" type="date" required />
                </label>
                <Button variant="outline">Add leave</Button>
              </form>
            )}
          </CardContent>
        </Card>
      ))}
    </>
  );
}
