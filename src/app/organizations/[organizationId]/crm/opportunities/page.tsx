import Link from "next/link";
import { randomUUID } from "node:crypto";
import { organizationContext } from "@/modules/organizations/page-context";
import { listContacts } from "@/modules/crm/service";
import {
  listOpportunities,
  opportunityNext,
  opportunityQuery,
  stages,
} from "@/modules/crm/opportunities";
import { addOpportunity, moveOpportunity } from "@/app/opportunity-actions";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/message";
export default async function Opportunities({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{
    q?: string;
    stage?: string;
    page?: string;
    error?: string;
  }>;
}) {
  const { organizationId: org } = await params;
  const { user, role } = await organizationContext(org);
  const query = await searchParams;
  const parsed = opportunityQuery.safeParse({
    search: query.q,
    stage: query.stage,
    page: query.page,
  });
  const filter = parsed.success ? parsed.data : opportunityQuery.parse({});
  const data = await listOpportunities(user.id, org, filter);
  const contacts = (await listContacts(user.id, org)).filter(
    (c) => c.status !== "ARCHIVED",
  );
  const writable = role === "OWNER" || role === "ADMIN";
  const base = `/organizations/${org}/crm`;
  function pageLink(page: number) {
    const q = new URLSearchParams({
      q: filter.search,
      stage: filter.stage,
      page: String(page),
    });
    return `${base}/opportunities?${q}`;
  }
  return (
    <>
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold">Opportunities</h1>
        <p className="text-muted-foreground">
          Track potential business against existing contacts. Values are
          estimates in INR, not payments or recognized revenue.
        </p>
        <Link href={base} className="text-primary underline">
          Client relationships
        </Link>
      </div>
      <Message
        error={
          query.error ??
          (!parsed.success
            ? "Invalid filters. Showing the default pipeline."
            : undefined)
        }
      />
      <div className="grid gap-4 sm:grid-cols-4">
        {stages.map((stage) => (
          <Card key={stage}>
            <CardHeader>
              <CardTitle>{stage.toLowerCase()}</CardTitle>
              <p className="text-3xl font-semibold">
                {data.counts.find((c) => c.stage === stage)?._count._all ?? 0}
              </p>
            </CardHeader>
          </Card>
        ))}
      </div>
      {writable && (
        <Card>
          <CardHeader>
            <CardTitle>Add opportunity</CardTitle>
          </CardHeader>
          <CardContent>
            {contacts.length ? (
              <form
                action={addOpportunity.bind(null, org)}
                className="grid items-end gap-4 md:grid-cols-2"
              >
                <input type="hidden" name="requestKey" value={randomUUID()} />
                <label>
                  Existing contact
                  <select
                    name="contactId"
                    required
                    className="mt-2 block w-full rounded-md border bg-background p-2"
                  >
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {c.email}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Opportunity title
                  <Input name="title" minLength={2} maxLength={160} required />
                </label>
                <label>
                  Estimated value (INR)
                  <Input
                    name="amount"
                    type="text"
                    inputMode="decimal"
                    pattern="(?:0|[1-9][0-9]{0,7})(?:\.[0-9]{1,2})?"
                    maxLength={11}
                    required
                    placeholder="2500.00"
                  />
                </label>
                <Button>Create opportunity</Button>
              </form>
            ) : (
              <p>Create an active contact in Client relationships first.</p>
            )}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Pipeline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label>
              Search opportunities
              <Input name="q" maxLength={100} defaultValue={filter.search} />
            </label>
            <label>
              Stage
              <select
                name="stage"
                defaultValue={filter.stage}
                className="mt-2 block rounded-md border bg-background p-2"
              >
                <option value="">All stages</option>
                {stages.map((stage) => (
                  <option key={stage}>{stage}</option>
                ))}
              </select>
            </label>
            <Button variant="outline">Filter opportunities</Button>
          </form>
          <p className="text-sm text-muted-foreground">
            {data.total} matching opportunities · Page {data.page}
          </p>
          <ul className="divide-y">
            {data.opportunities.map((o) => (
              <li key={o.id} className="space-y-3 py-4">
                <div className="flex flex-wrap justify-between gap-3">
                  <div>
                    <h3 className="font-medium">{o.title}</h3>
                    <p className="text-sm text-muted-foreground">
                      {o.contact.name} · {o.contact.email}
                    </p>
                  </div>
                  <p>
                    {new Intl.NumberFormat("en-IN", {
                      style: "currency",
                      currency: "INR",
                    }).format(o.amountPaise / 100)}{" "}
                    · {o.stage.toLowerCase()}
                  </p>
                </div>
                {writable && opportunityNext[o.stage]?.length > 0 && (
                  <form
                    action={moveOpportunity.bind(null, org)}
                    className="flex flex-wrap gap-2"
                  >
                    <input type="hidden" name="opportunityId" value={o.id} />
                    <input type="hidden" name="version" value={o.version} />
                    {opportunityNext[o.stage].map((stage) => (
                      <Button
                        key={stage}
                        variant="outline"
                        name="stage"
                        value={stage}
                      >
                        Move to {stage.toLowerCase()}
                      </Button>
                    ))}
                  </form>
                )}
              </li>
            ))}
          </ul>
          {!data.opportunities.length && (
            <p>No opportunities match these filters.</p>
          )}
          <nav
            aria-label="Opportunity pages"
            className="flex gap-4 text-primary underline"
          >
            {data.page > 1 && (
              <Link href={pageLink(data.page - 1)}>Previous page</Link>
            )}
            {data.page * 25 < data.total && (
              <Link href={pageLink(data.page + 1)}>Next page</Link>
            )}
          </nav>
        </CardContent>
      </Card>
    </>
  );
}
