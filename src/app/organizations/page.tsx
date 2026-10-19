import Link from "next/link";
import { requireSession } from "@/lib/session";
import { listOrganizations } from "@/modules/organizations/service";
import { createOrganization, signOut } from "@/app/actions";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Message } from "@/components/message";
export default async function Organizations({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { user } = await requireSession();
  const organizations = await listOrganizations(user.id);
  const { error } = await searchParams;
  return (
    <main className="mx-auto max-w-5xl space-y-8 p-6 md:p-12">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-widest text-primary">
            BBD / MASTER ATMA OS
          </p>
          <h1 className="mt-3 text-3xl font-semibold">Your organizations</h1>
          <p className="mt-2 text-muted-foreground">
            Welcome, {user.name}. Choose the workspace you want to manage.
          </p>
        </div>
        <form action={signOut}>
          <Button variant="outline">Sign out</Button>
        </form>
      </header>
      <Message error={error} />
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Workspaces</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {organizations.length ? (
              organizations.map((org) => (
                <Link
                  key={org.id}
                  href={`/organizations/${org.id}`}
                  className="block rounded-lg border p-4 font-medium hover:bg-muted"
                >
                  {org.name}
                  <span className="mt-1 block text-xs text-muted-foreground">
                    /{org.slug} →
                  </span>
                </Link>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                You have no organizations yet. Create your first workspace or
                accept an invitation.
              </p>
            )}
            <Link
              href="/invitations"
              className="block pt-3 text-sm text-primary underline"
            >
              Accept an invitation
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Create organization</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createOrganization} className="space-y-4">
              <label>
                Organization name
                <Input name="name" required minLength={2} maxLength={100} />
              </label>
              <label>
                Workspace address
                <Input
                  name="slug"
                  required
                  minLength={3}
                  maxLength={50}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  placeholder="your-organization"
                />
              </label>
              <p className="text-xs text-muted-foreground">
                Lowercase letters, numbers and hyphens. You become the
                organization owner.
              </p>
              <Button>Create workspace</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
