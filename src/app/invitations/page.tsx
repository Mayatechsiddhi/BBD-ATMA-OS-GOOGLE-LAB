import { requireSession } from "@/lib/session";
import { AcceptInvitationForm } from "@/components/accept-invitation-form";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Message } from "@/components/message";
import Link from "next/link";
export default async function Invitations({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { user } = await requireSession();
  const { error } = await searchParams;
  return (
    <main className="mx-auto max-w-xl space-y-6 p-10">
      <Link href="/organizations" className="text-sm text-primary underline">
        ← Organizations
      </Link>
      <Message error={error} />
      <Card>
        <CardHeader>
          <CardTitle>Join an organization</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-5 text-sm text-muted-foreground">
            Signed in as {user.email}. The invitation must match this address.
          </p>
          <AcceptInvitationForm />
        </CardContent>
      </Card>
    </main>
  );
}
