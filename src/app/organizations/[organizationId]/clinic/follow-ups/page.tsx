import Link from "next/link";
import { organizationContext } from "@/modules/organizations/page-context";
import { listFollowUps } from "@/modules/clinic/service";
import { followUpStatus } from "@/modules/clinic/validation";
import { displayTime, localInput } from "@/modules/clinic/time";
import {
  changeClinicFollowUpStatus,
  editClinicFollowUp,
} from "@/app/clinic-actions";
import { ClinicHeader } from "@/components/clinic";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/message";
export default async function FollowUps({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const { organizationId: org } = await params;
  const { user, role } = await organizationContext(org, "clinic");
  const query = await searchParams;
  const parsed = followUpStatus.safeParse(query.status ?? "OPEN");
  const tasks = parsed.success
    ? await listFollowUps(user.id, org, parsed.data)
    : [];
  const now = new Date();
  return (
    <>
      <ClinicHeader
        org={org}
        title="Follow-up tracker"
        description="Create tasks from a lead record. Tasks are ordered by due time, with overdue open work first. Up to 100 entries per status; times in IST."
      />
      <Message error={query.error} />
      <Card>
        <CardHeader>
          <CardTitle>Follow-up tasks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <form method="get" className="flex items-end gap-3">
            <label>
              Follow-up status
              <select
                name="status"
                defaultValue={query.status ?? "OPEN"}
                className="block h-10 rounded-md border bg-background px-3"
              >
                {followUpStatus.options.map((s) => (
                  <option key={s} value={s}>
                    {s.toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="outline">Filter follow-ups</Button>
          </form>
          {!parsed.success && (
            <Message error="Choose a valid follow-up status." />
          )}
          <ul className="divide-y">
            {tasks.map((f) => (
              <li key={f.id} className="space-y-3 py-4">
                <div className="flex flex-wrap justify-between gap-3">
                  <div>
                    <p className="font-medium">{f.title}</p>
                    <Link
                      className="text-sm text-primary underline"
                      href={`/organizations/${org}/clinic/leads/${f.leadId}`}
                    >
                      {f.lead.name}
                    </Link>
                    <p className="mt-1 text-sm">
                      Due {displayTime(f.dueAt)}
                      {f.completedAt &&
                        ` · Completed ${displayTime(f.completedAt)}`}
                    </p>
                  </div>
                  <p
                    className={
                      f.status === "OPEN" && f.dueAt < now
                        ? "text-sm font-semibold text-destructive"
                        : "text-sm lowercase"
                    }
                  >
                    {f.status === "OPEN" && f.dueAt < now
                      ? "Overdue"
                      : f.status.toLowerCase()}
                  </p>
                </div>
                {role !== "MEMBER" && f.status === "OPEN" && (
                  <>
                    <form
                      action={changeClinicFollowUpStatus.bind(null, org)}
                      className="flex gap-2"
                    >
                      <input type="hidden" name="followUpId" value={f.id} />
                      <Button name="status" value="DONE">
                        Complete follow-up
                      </Button>
                      <Button name="status" value="CANCELLED" variant="outline">
                        Cancel follow-up
                      </Button>
                    </form>
                    <details>
                      <summary className="cursor-pointer text-sm text-primary">
                        Edit follow-up
                      </summary>
                      <form
                        action={editClinicFollowUp.bind(null, org)}
                        className="mt-3 flex flex-wrap items-end gap-3"
                      >
                        <input type="hidden" name="followUpId" value={f.id} />
                        <label>
                          Follow-up task
                          <Input
                            name="title"
                            defaultValue={f.title}
                            required
                            minLength={2}
                            maxLength={160}
                          />
                        </label>
                        <label>
                          Due (IST)
                          <Input
                            name="dueAt"
                            type="datetime-local"
                            defaultValue={localInput(f.dueAt)}
                            required
                          />
                        </label>
                        <Button variant="outline">Save follow-up</Button>
                      </form>
                    </details>
                  </>
                )}
              </li>
            ))}
          </ul>
          {parsed.success && !tasks.length && (
            <p className="text-sm text-muted-foreground">
              No follow-ups with this status.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
