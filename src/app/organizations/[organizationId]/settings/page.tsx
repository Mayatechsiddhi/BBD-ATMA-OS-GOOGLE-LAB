import { organizationContext } from "@/modules/organizations/page-context";
import { updateOrganization } from "@/app/actions";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/message";
export default async function Settings({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { organizationId } = await params;
  const { organization, role } = await organizationContext(organizationId);
  const { error } = await searchParams;
  return (
    <>
      <h1 className="text-3xl font-semibold">Organization settings</h1>
      <Message error={error} />
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Workspace details</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            action={updateOrganization.bind(null, organizationId)}
            className="space-y-5"
          >
            <label>
              Organization name
              <Input
                name="name"
                required
                minLength={2}
                maxLength={100}
                defaultValue={organization.name}
                disabled={role === "MEMBER"}
              />
            </label>
            <label>
              Workspace address
              <Input value={organization.slug} readOnly />
            </label>
            <p className="text-sm text-muted-foreground">
              Owners and administrators can edit workspace details. The
              workspace address is fixed for this milestone.
            </p>
            {role !== "MEMBER" && <Button>Save changes</Button>}
          </form>
        </CardContent>
      </Card>
    </>
  );
}
