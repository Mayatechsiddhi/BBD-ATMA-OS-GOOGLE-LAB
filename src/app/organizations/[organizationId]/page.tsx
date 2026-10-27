import Link from "next/link";
import { organizationContext } from "@/modules/organizations/page-context";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
export default async function Dashboard({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  const { organization, members, invitations, events, role } =
    await organizationContext(organizationId);
  return (
    <>
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">
          Organization overview
        </p>
        <h1 className="mt-2 text-3xl font-semibold">{organization.name}</h1>
        <p className="mt-2 text-muted-foreground">
          Manage your people, access and operating foundation.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ["Active members", members.length],
          ["Your access", role.toLowerCase()],
          [
            "Pending invitations",
            role === "MEMBER" ? "Restricted" : invitations.length,
          ],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardHeader>
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="text-3xl font-semibold capitalize">{value}</p>
            </CardHeader>
          </Card>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Workspace administration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Link
              className="block text-sm font-medium text-primary underline"
              href={`/organizations/${organizationId}/clinic`}
            >
              Open clinic CRM →
            </Link>
            <Link
              className="block text-sm font-medium text-primary underline"
              href={`/organizations/${organizationId}/crm`}
            >
              Open client relationship workflow →
            </Link>
            <p className="text-sm text-muted-foreground">
              Membership and access are scoped to this organization. Changes are
              recorded in the activity log.
            </p>
            <Link
              className="block text-sm font-medium text-primary underline"
              href={`/organizations/${organizationId}/members`}
            >
              Manage people & access →
            </Link>
            <Link
              className="block text-sm font-medium text-primary underline"
              href={`/organizations/${organizationId}/settings`}
            >
              Organization settings →
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {events.map((event) => (
                <li
                  className="flex justify-between gap-4 py-3 text-sm"
                  key={event.id}
                >
                  <span>
                    {event.action.replaceAll(".", " ").replaceAll("_", " ")}
                  </span>
                  <time
                    className="text-xs text-muted-foreground"
                    dateTime={event.createdAt.toISOString()}
                  >
                    {event.createdAt
                      .toISOString()
                      .slice(0, 16)
                      .replace("T", " ")}{" "}
                    UTC
                  </time>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
