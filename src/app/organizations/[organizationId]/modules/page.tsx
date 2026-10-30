import { listModules } from "@/modules/entitlements/service";
import { updateModuleAccess } from "@/app/module-actions";
import { organizationContext } from "@/modules/organizations/page-context";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/message";
export default async function Modules({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { organizationId } = await params;
  const { user, role } = await organizationContext(organizationId);
  const modules = await listModules(user.id, organizationId);
  return (
    <>
      <h1 className="text-3xl font-semibold">Platform modules</h1>
      <p className="text-muted-foreground">
        Owners manage module access for this organization. Disabling a module
        preserves its data. Planned capabilities cannot be enabled.
      </p>
      <Message error={(await searchParams).error} />
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {modules.map((module) => (
          <Card key={module.id}>
            <CardHeader>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {!module.available
                  ? "Planned"
                  : module.enabled
                    ? "Enabled"
                    : "Disabled"}
              </p>
              <CardTitle>{module.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {module.description}
              </p>
              {role === "OWNER" && module.available && (
                <form action={updateModuleAccess.bind(null, organizationId)}>
                  <input type="hidden" name="moduleId" value={module.id} />
                  <input
                    type="hidden"
                    name="enabled"
                    value={String(!module.enabled)}
                  />
                  <input type="hidden" name="version" value={module.version} />
                  <Button
                    variant="outline"
                    aria-label={`${module.enabled ? "Disable" : "Enable"} ${module.name}`}
                  >
                    {module.enabled ? "Disable" : "Enable"}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
