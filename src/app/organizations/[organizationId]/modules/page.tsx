import { modules } from "@/modules/registry";
import { organizationContext } from "@/modules/organizations/page-context";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
export default async function Modules({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  await organizationContext((await params).organizationId);
  return (
    <>
      <h1 className="text-3xl font-semibold">Platform modules</h1>
      <p className="text-muted-foreground">
        Architecture boundaries for upcoming milestones. These capabilities are
        not yet implemented.
      </p>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {modules.map((module) => (
          <Card key={module.id}>
            <CardHeader>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Planned
              </p>
              <CardTitle>{module.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {module.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
