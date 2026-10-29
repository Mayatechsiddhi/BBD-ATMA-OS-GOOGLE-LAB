import Link from "next/link";
import type { Appointment, ClinicLead } from "@/generated/prisma/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  appointmentTransitions,
  leadTransitions,
} from "@/modules/clinic/workflow";
import { localInput } from "@/modules/clinic/time";
import { sources } from "@/modules/clinic/validation";
import {
  changeClinicAppointmentStatus,
  changeClinicLeadStatus,
} from "@/app/clinic-actions";
export function ClinicHeader({
  org,
  title,
  description,
}: {
  org: string;
  title: string;
  description: string;
}) {
  const base = `/organizations/${org}/clinic`;
  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">
        Clinic CRM
      </p>
      <h1 className="text-3xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
      <nav
        aria-label="Clinic"
        className="flex flex-wrap gap-4 text-sm text-primary underline"
      >
        {[
          ["", "Dashboard"],
          ["/leads", "Leads"],
          ["/appointments", "Appointments"],
          ["/schedules", "Doctor schedules"],
          ["/follow-ups", "Follow-ups"],
          ["/reception", "Reception & calling"],
        ].map(([path, label]) => (
          <Link key={path} href={base + path}>
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
export function LeadFields({ lead }: { lead?: ClinicLead }) {
  return (
    <>
      <label>
        Lead name
        <Input
          name="name"
          defaultValue={lead?.name}
          required
          minLength={2}
          maxLength={100}
        />
      </label>
      <label>
        Phone
        <Input
          name="phone"
          type="tel"
          defaultValue={lead?.phone}
          required
          maxLength={25}
        />
      </label>
      <label>
        Email (optional)
        <Input
          name="email"
          type="email"
          defaultValue={lead?.email ?? ""}
          maxLength={254}
        />
      </label>
      <label>
        Lead source
        <select
          name="source"
          defaultValue={lead?.source ?? "PHONE"}
          className="mt-2 block h-10 w-full rounded-md border bg-background px-3"
        >
          {sources.map((s) => (
            <option key={s} value={s}>
              {s.toLowerCase().replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
export function AppointmentFields({
  appointment,
}: {
  appointment?: Appointment;
}) {
  return (
    <>
      <label>
        Practitioner or resource
        <Input
          name="resource"
          required
          minLength={2}
          maxLength={80}
          defaultValue={appointment?.resource}
          placeholder="Doctor or room name"
        />
      </label>
      <label>
        Start (IST)
        <Input
          name="startsAt"
          type="datetime-local"
          required
          defaultValue={
            appointment ? localInput(appointment.startsAt) : undefined
          }
        />
      </label>
      <label>
        End (IST)
        <Input
          name="endsAt"
          type="datetime-local"
          required
          defaultValue={
            appointment ? localInput(appointment.endsAt) : undefined
          }
        />
      </label>
    </>
  );
}
export function LeadStatusForm({
  org,
  lead,
}: {
  org: string;
  lead: ClinicLead;
}) {
  return leadTransitions[lead.status].length ? (
    <form
      action={changeClinicLeadStatus.bind(null, org)}
      className="flex flex-wrap gap-2"
    >
      <input type="hidden" name="leadId" value={lead.id} />
      {leadTransitions[lead.status].map((status) => (
        <Button key={status} name="status" value={status} variant="outline">
          {status.toLowerCase()}
        </Button>
      ))}
    </form>
  ) : (
    <p className="text-sm text-muted-foreground">This lead is closed.</p>
  );
}
export function AppointmentStatusForm({
  org,
  appointment,
}: {
  org: string;
  appointment: Appointment;
}) {
  const now = new Date();
  const statuses = appointmentTransitions[appointment.status].filter(
    (s) =>
      !["CHECKED_IN", "COMPLETED", "NO_SHOW"].includes(s) ||
      appointment.startsAt <= now,
  );
  return (
    <form
      action={changeClinicAppointmentStatus.bind(null, org)}
      className="flex flex-wrap gap-2"
    >
      <input type="hidden" name="appointmentId" value={appointment.id} />
      {statuses.map((status) => (
        <Button key={status} name="status" value={status} variant="outline">
          {status.toLowerCase().replaceAll("_", " ")}
        </Button>
      ))}
    </form>
  );
}
