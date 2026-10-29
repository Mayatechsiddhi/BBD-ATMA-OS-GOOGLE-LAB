"use client";
import { useActionState, useState } from "react";
import { findClinicSlots, bookClinicAppointment } from "@/app/clinic-actions";
import { displayTime, localInput } from "@/modules/clinic/time";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/lib/use-hydrated";

export function AppointmentSlots({
  org,
  leadId,
  doctors,
}: {
  org: string;
  leadId: string;
  doctors: {
    id: string;
    name: string;
    room: string;
    duration?: number | null;
  }[];
}) {
  const [state, action, pending] = useActionState(findClinicSlots, {});
  const hydrated = useHydrated();
  // React resets uncontrolled form fields after an action returns, including
  // validation errors. Preserve the search so staff can correct or retry it.
  const [doctorId, setDoctorId] = useState(doctors[0]?.id ?? "");
  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");
  const [duration, setDuration] = useState("30");
  const [edited, setEdited] = useState(false);
  const configuredDuration = doctors.find((d) => d.id === doctorId)?.duration;
  return (
    <section
      aria-label="Appointment suggestions"
      className="mb-6 space-y-4 border-b pb-6"
    >
      <h3 className="font-medium">Find appointment slots</h3>
      <p className="text-sm text-muted-foreground">
        Saved doctor hours, breaks, leave and duration apply. For an
        unconfigured doctor, choose a window agreed with them. Suggestions
        exclude doctor and patient conflicts; they are not reservations.
        Availability is checked again when booking.
      </p>
      {!doctors.length ? (
        <p>
          Add a doctor queue in Reception to use suggestions. Manual booking
          remains available below.
        </p>
      ) : (
        <>
          <form
            action={action}
            data-hydrated={hydrated}
            className="grid gap-3"
            onChange={() => setEdited(true)}
            onSubmit={() => setEdited(false)}
          >
            <input type="hidden" name="organizationId" value={org} />
            <input type="hidden" name="leadId" value={leadId} />
            <label>
              Suggestion doctor
              <select
                name="doctorId"
                value={doctorId}
                onChange={(event) => setDoctorId(event.target.value)}
                className="mt-2 block w-full rounded-md border bg-background p-2"
                required
              >
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} · {d.room}
                    {d.duration
                      ? ` · ${d.duration} minutes`
                      : " · hours not configured"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Search start (IST)
              <Input
                name="windowStart"
                type="datetime-local"
                value={windowStart}
                onChange={(event) => setWindowStart(event.target.value)}
                required
              />
            </label>
            <label>
              Search end (IST)
              <Input
                name="windowEnd"
                type="datetime-local"
                value={windowEnd}
                onChange={(event) => setWindowEnd(event.target.value)}
                required
              />
            </label>
            <label>
              Duration (minutes)
              <Input
                name="duration"
                type="number"
                min={15}
                max={480}
                step={15}
                value={configuredDuration ?? duration}
                readOnly={!!configuredDuration}
                onChange={(event) => setDuration(event.target.value)}
                required
              />
            </label>
            <p className="text-xs text-muted-foreground">
              Today through 30 days; one clinic day, at most eight hours. Up to
              five suggestions on a 15-minute grid.
            </p>
            <Button variant="outline" disabled={pending || !hydrated}>
              {pending ? "Searching…" : "Find slots"}
            </Button>
          </form>
          {state.error && <p role="alert">{state.error}</p>}
          {!pending && !edited && state.slots && (
            <div role="status" className="space-y-3">
              {!state.slots.length && <p>No available slots in this window.</p>}
              {state.slots.map((s) => (
                <form
                  key={s.startsAt}
                  action={bookClinicAppointment.bind(null, org)}
                >
                  <input type="hidden" name="leadId" value={leadId} />
                  <input type="hidden" name="resource" value={s.resource} />
                  <input
                    type="hidden"
                    name="startsAt"
                    value={localInput(new Date(s.startsAt))}
                  />
                  <input
                    type="hidden"
                    name="endsAt"
                    value={localInput(new Date(s.endsAt))}
                  />
                  <Button
                    variant="outline"
                    className="h-auto whitespace-normal text-left"
                  >
                    Book suggested slot: {displayTime(new Date(s.startsAt))} –{" "}
                    {displayTime(new Date(s.endsAt))}
                  </Button>
                </form>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
