import Link from "next/link";
import { organizationContext } from "@/modules/organizations/page-context";
import { listLeads } from "@/modules/clinic/service";
import { leadQuery, leadStatus } from "@/modules/clinic/validation";
import { addClinicLead } from "@/app/clinic-actions";
import { ClinicHeader, LeadFields } from "@/components/clinic";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/message";
export default async function Leads({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{
    q?: string;
    status?: string;
    page?: string;
    error?: string;
  }>;
}) {
  const { organizationId: org } = await params;
  const { user, role } = await organizationContext(org, "clinic");
  const query = await searchParams;
  const parsed = leadQuery.safeParse({
    search: query.q,
    status: query.status,
    page: query.page,
  });
  const data = parsed.success
    ? await listLeads(user.id, org, parsed.data)
    : null;
  const base = `/organizations/${org}/clinic/leads`;
  const pageLink = (page: number) =>
    `${base}?${new URLSearchParams({ q: parsed.success ? parsed.data.search : "", status: parsed.success ? parsed.data.status : "", page: String(page) })}`;
  return (
    <>
      <ClinicHeader
        org={org}
        title="Clinic leads"
        description="Manage enquiries and contact details. Record administrative information only; do not enter medical history here."
      />
      <Message error={query.error} />
      {role !== "MEMBER" && (
        <Card>
          <CardHeader>
            <CardTitle>Add clinic lead</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              action={addClinicLead.bind(null, org)}
              className="grid items-end gap-4 md:grid-cols-2"
            >
              <LeadFields />
              <Button>Add clinic lead</Button>
            </form>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Lead directory</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label>
              Search leads
              <Input name="q" maxLength={100} defaultValue={query.q} />
            </label>
            <label>
              Lead status
              <select
                name="status"
                defaultValue={query.status ?? ""}
                className="block h-10 rounded-md border bg-background px-3"
              >
                <option value="">All statuses</option>
                {leadStatus.options.map((s) => (
                  <option key={s} value={s}>
                    {s.toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="outline">Filter leads</Button>
          </form>
          {!data ? (
            <Message error="Invalid search filters. Use a valid status and page number." />
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {data.total} leads · Page {data.page} · 25 per page
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="pb-3">Lead</th>
                      <th>Phone</th>
                      <th>Source</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.leads.map((lead) => (
                      <tr key={lead.id} className="border-b">
                        <td className="py-4 pr-4">
                          <Link
                            className="font-medium text-primary underline"
                            href={`${base}/${lead.id}`}
                          >
                            {lead.name}
                          </Link>
                        </td>
                        <td className="pr-4">{lead.phone}</td>
                        <td className="pr-4 lowercase">
                          {lead.source.replaceAll("_", " ")}
                        </td>
                        <td className="lowercase">{lead.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data.leads.length && (
                <p className="text-sm text-muted-foreground">
                  No matching leads.
                </p>
              )}
              <nav
                aria-label="Lead pages"
                className="flex gap-4 text-sm text-primary underline"
              >
                {data.page > 1 && (
                  <Link href={pageLink(data.page - 1)}>Previous</Link>
                )}
                {data.page * 25 < data.total && (
                  <Link href={pageLink(data.page + 1)}>Next</Link>
                )}
              </nav>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
