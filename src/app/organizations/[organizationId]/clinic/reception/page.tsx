import Link from "next/link";
import { organizationContext } from "@/modules/organizations/page-context";
import { reception } from "@/modules/calling/service";
import { queueQuery, queueTransitions } from "@/modules/calling/validation";
import { ClinicHeader, LeadFields } from "@/components/clinic";
import { CallingLive } from "@/components/calling-live";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/message";
import {
  registerClinicPatient,
  registerClinicLead,
  addClinicDoctor,
  editClinicDoctor,
  issueClinicToken,
  changeClinicToken,
} from "@/app/calling-actions";
export default async function Reception({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{
    day?: string;
    doctorId?: string;
    search?: string;
    patientPage?: string;
    page?: string;
    error?: string;
  }>;
}) {
  const { organizationId: org } = await params;
  const { user, role } = await organizationContext(org);
  const query = await searchParams;
  const parsed = queueQuery.safeParse(query);
  if (!parsed.success) return <Message error="Invalid queue filters." />;
  const data = await reception(user.id, org, parsed.data);
  const writable = role === "OWNER" || role === "ADMIN";
  const doctors = (label: string) => (
    <label>
      {label}
      <select
        name="doctorId"
        required
        className="block h-10 w-full rounded-md border bg-background px-3"
      >
        {data.doctors.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name} · Room {d.room}
          </option>
        ))}
      </select>
    </label>
  );
  const base = `/organizations/${org}/clinic/reception`;
  return (
    <>
      <ClinicHeader
        org={org}
        title="Reception & patient queues"
        description="Administrative registration and daily tokens. Staff-only patient information; times and token days use IST."
      />
      <Message error={query.error} />
      <CallingLive org={org} />
      <Link
        className="text-primary underline"
        href={`/display/${org}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        Open private calling display
      </Link>
      {writable && (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="space-y-4 rounded-xl border p-5">
            <h2 className="text-xl font-semibold">Register patient</h2>
            <p className="text-sm">
              Administrative contact details only. Search existing patients
              before registering; family phone numbers may be shared.
            </p>
            <form
              action={registerClinicPatient.bind(null, org)}
              className="grid gap-4"
            >
              <LeadFields />
              <Button>Register patient</Button>
            </form>
            <details>
              <summary>Register an existing clinic lead</summary>
              <form
                action={registerClinicLead.bind(null, org)}
                className="mt-3 space-y-3"
              >
                <label>
                  Existing lead ID
                  <Input name="leadId" required maxLength={100} />
                </label>
                <Button variant="outline">Register existing lead</Button>
              </form>
            </details>
          </section>
          <section className="space-y-4 rounded-xl border p-5">
            <h2 className="text-xl font-semibold">Doctor queues</h2>
            <form
              action={addClinicDoctor.bind(null, org)}
              className="space-y-3"
            >
              <label>
                Doctor name
                <Input name="name" required minLength={2} maxLength={100} />
              </label>
              <label>
                Room
                <Input name="room" required maxLength={40} />
              </label>
              <label>
                Appointment resource label
                <Input name="resource" required minLength={2} maxLength={80} />
              </label>
              <p className="text-sm">
                Must match the existing appointment practitioner/resource label.
                The stable resource key cannot be renamed.
              </p>
              <Button>Add doctor queue</Button>
            </form>
            {data.doctors.map((d) => (
              <details key={d.id}>
                <summary>
                  {d.name} · Room {d.room}
                </summary>
                <form
                  action={editClinicDoctor.bind(null, org)}
                  className="space-y-3"
                >
                  <input type="hidden" name="doctorId" value={d.id} />
                  <label>
                    Doctor name
                    <Input
                      name="name"
                      defaultValue={d.name}
                      required
                      minLength={2}
                      maxLength={100}
                    />
                  </label>
                  <label>
                    Room
                    <Input
                      name="room"
                      defaultValue={d.room}
                      required
                      maxLength={40}
                    />
                  </label>
                  <Button variant="outline">Update doctor details</Button>
                </form>
              </details>
            ))}
          </section>
        </div>
      )}
      <section className="space-y-4 rounded-xl border p-5">
        <h2 className="text-xl font-semibold">Registered patients</h2>
        <form method="get" className="flex gap-3">
          <label>
            Search patient name or phone
            <Input
              name="search"
              defaultValue={parsed.data.search}
              maxLength={100}
            />
          </label>
          <Button variant="outline">Search patients</Button>
        </form>
        <p className="text-sm">
          {data.totalPatients} matching registered patients · page{" "}
          {parsed.data.patientPage} · 25 per page.
        </p>
        <div className="space-y-4">
          {data.patients.map((p) => (
            <article key={p.id} className="rounded-lg border p-4">
              <p>
                {p.lead.name} · {p.lead.phone}
              </p>
              {writable && data.doctors.length > 0 && (
                <form
                  action={issueClinicToken.bind(null, org)}
                  className="mt-3 flex flex-wrap items-end gap-3"
                >
                  <input type="hidden" name="patientId" value={p.id} />
                  {doctors("Doctor for walk-in")}
                  <Button>Issue walk-in token</Button>
                </form>
              )}
            </article>
          ))}
        </div>
        <nav
          aria-label="Patient pages"
          className="flex gap-4 text-primary underline"
        >
          {parsed.data.patientPage > 1 && (
            <Link
              href={`${base}?search=${encodeURIComponent(parsed.data.search)}&patientPage=${parsed.data.patientPage - 1}`}
            >
              Previous patients
            </Link>
          )}
          {parsed.data.patientPage * 25 < data.totalPatients && (
            <Link
              href={`${base}?search=${encodeURIComponent(parsed.data.search)}&patientPage=${parsed.data.patientPage + 1}`}
            >
              Next patients
            </Link>
          )}
        </nav>
      </section>
      {writable && (
        <section className="space-y-4 rounded-xl border p-5">
          <h2 className="text-xl font-semibold">
            Today&apos;s appointments awaiting tokens
          </h2>
          <p className="text-sm">
            Up to 100 active appointments today. Patient registration is reused
            or created atomically when issuing a token. Calls cannot check in an
            appointment before its start time.
          </p>
          {data.appointments.map((a) => (
            <form
              key={a.id}
              action={issueClinicToken.bind(null, org)}
              className="flex flex-wrap items-end gap-3 border-b py-3"
            >
              <p>
                {a.lead.name} · {a.resource}
              </p>
              <input type="hidden" name="appointmentId" value={a.id} />
              {doctors("Appointment doctor")}
              <Button disabled={!data.doctors.length}>
                Issue appointment token
              </Button>
            </form>
          ))}
        </section>
      )}
      <section className="space-y-4 rounded-xl border p-5">
        <h2 className="text-xl font-semibold">
          Reception queue · {parsed.data.day}
        </h2>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label>
            Queue day (IST)
            <Input
              type="date"
              name="day"
              defaultValue={parsed.data.day}
              required
            />
          </label>
          <label>
            Filter doctor
            <select
              name="doctorId"
              defaultValue={parsed.data.doctorId}
              className="block h-10 rounded-md border bg-background px-3"
            >
              <option value="">All doctors</option>
              {data.doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <Button variant="outline">Filter queue</Button>
        </form>
        <p>
          {data.total} tokens · page {parsed.data.page} · 50 per page
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th>Token</th>
                <th>Patient (staff only)</th>
                <th>Doctor / room</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.tokens.map((t) => (
                <tr
                  key={t.id}
                  className="border-b"
                  data-testid={`token-${t.id}`}
                >
                  <td className="py-4 font-bold">
                    {String(t.number).padStart(3, "0")}
                  </td>
                  <td>{t.patient.lead.name}</td>
                  <td>
                    {t.doctor.name} / {t.doctor.room}
                  </td>
                  <td>{t.status.toLowerCase()}</td>
                  <td>
                    {writable && (
                      <form
                        action={changeClinicToken.bind(null, org)}
                        className="flex flex-wrap gap-2"
                      >
                        <input type="hidden" name="tokenId" value={t.id} />
                        {queueTransitions[t.status].map((action) => (
                          <Button
                            key={action}
                            name="action"
                            value={action}
                            variant="outline"
                          >
                            {action.toLowerCase()}
                          </Button>
                        ))}
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <nav
          aria-label="Queue pages"
          className="flex gap-4 text-primary underline"
        >
          {parsed.data.page > 1 && (
            <Link
              href={`${base}?day=${encodeURIComponent(parsed.data.day)}&doctorId=${encodeURIComponent(parsed.data.doctorId)}&page=${parsed.data.page - 1}`}
            >
              Previous
            </Link>
          )}
          {parsed.data.page * 50 < data.total && (
            <Link
              href={`${base}?day=${encodeURIComponent(parsed.data.day)}&doctorId=${encodeURIComponent(parsed.data.doctorId)}&page=${parsed.data.page + 1}`}
            >
              Next
            </Link>
          )}
        </nav>
      </section>
    </>
  );
}
