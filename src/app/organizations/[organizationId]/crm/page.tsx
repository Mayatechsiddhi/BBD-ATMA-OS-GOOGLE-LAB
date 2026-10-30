import { organizationContext } from "@/modules/organizations/page-context";
import { listContacts } from "@/modules/crm/service";
import { nextStatuses } from "@/modules/crm/workflow";
import { createContact, transitionContact } from "@/app/actions";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/message";
import Link from "next/link";
export default async function CRM({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { organizationId } = await params;
  const { user, role } = await organizationContext(organizationId, "crm");
  const contacts = await listContacts(user.id, organizationId);
  const { error } = await searchParams;
  return (
    <>
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">
          Client workflow
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Client relationships</h1>
        <Link
          href={`/organizations/${organizationId}/crm/opportunities`}
          className="mt-3 inline-block text-primary underline"
        >
          Opportunities
        </Link>
        <p className="mt-2 text-muted-foreground">
          Capture a lead, qualify the relationship, then convert it to a
          customer. Every change is saved and audited.
        </p>
      </div>
      <Message error={error} />
      <div className="grid gap-4 sm:grid-cols-3">
        {(["LEAD", "QUALIFIED", "CUSTOMER"] as const).map((status) => (
          <Card key={status}>
            <CardHeader>
              <p className="text-sm capitalize text-muted-foreground">
                {status.toLowerCase()}
              </p>
              <p className="text-3xl font-semibold">
                {contacts.filter((c) => c.status === status).length}
              </p>
            </CardHeader>
          </Card>
        ))}
      </div>
      {role !== "MEMBER" && (
        <Card>
          <CardHeader>
            <CardTitle>Capture a new lead</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              action={createContact.bind(null, organizationId)}
              className="grid items-end gap-4 md:grid-cols-4"
            >
              <label>
                Contact name
                <Input name="name" required minLength={2} maxLength={100} />
              </label>
              <label>
                Email address
                <Input name="email" type="email" required maxLength={254} />
              </label>
              <label>
                Company (optional)
                <Input name="company" maxLength={150} />
              </label>
              <Button>Add lead</Button>
            </form>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Client pipeline</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {contacts.length ? (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="pb-3">Contact</th>
                  <th className="pb-3">Company</th>
                  <th className="pb-3">Status</th>
                  {role !== "MEMBER" && <th className="pb-3">Next step</th>}
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => (
                  <tr key={contact.id} className="border-b">
                    <td className="py-4 pr-4">
                      <p className="font-medium">{contact.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {contact.email}
                      </p>
                    </td>
                    <td className="pr-4">{contact.company ?? "—"}</td>
                    <td className="pr-4">
                      <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium lowercase">
                        {contact.status}
                      </span>
                    </td>
                    {role !== "MEMBER" && (
                      <td className="py-4">
                        {nextStatuses[contact.status].length ? (
                          <form
                            className="flex flex-wrap gap-2"
                            action={transitionContact.bind(
                              null,
                              organizationId,
                              contact.id,
                            )}
                          >
                            {nextStatuses[contact.status].map((status) => (
                              <Button
                                key={status}
                                name="status"
                                value={status}
                                variant={
                                  status === "ARCHIVED" ? "outline" : "default"
                                }
                              >
                                {status === "QUALIFIED"
                                  ? "Qualify lead"
                                  : status === "CUSTOMER"
                                    ? "Convert to customer"
                                    : "Archive"}
                              </Button>
                            ))}
                          </form>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Archived
                          </p>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="py-4 text-sm text-muted-foreground">
              No client records yet. An owner or administrator can capture the
              first lead.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
