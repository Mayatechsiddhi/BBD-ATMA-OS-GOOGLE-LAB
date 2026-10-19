"use client";
import { useActionState } from "react";
import { inviteMember } from "@/app/actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
export function InviteForm({
  organizationId,
  baseURL,
}: {
  organizationId: string;
  baseURL: string;
}) {
  const [state, action, pending] = useActionState(
    inviteMember.bind(null, organizationId),
    {},
  );
  return (
    <form action={action} className="space-y-4">
      <label>
        Email address
        <Input type="email" name="email" required maxLength={254} />
      </label>
      <label>
        Access level
        <select className="mt-2 block w-full" name="role">
          <option value="MEMBER">Member</option>
          <option value="ADMIN">Administrator</option>
        </select>
      </label>
      <Button disabled={pending}>
        {pending ? "Creating…" : "Create private invitation"}
      </Button>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.token && (
        <div role="status" className="space-y-3 rounded-lg border p-4">
          <p className="text-sm">
            Send this private link to the invited email address through a
            trusted channel. It expires in 48 hours.
          </p>
          <Input
            aria-label="Private invitation link"
            value={`${baseURL}/invitations#token=${state.token}`}
            readOnly
          />
          <p className="text-xs text-muted-foreground">
            Email delivery for invitations is manual in this milestone. The
            recipient must verify the invited address.
          </p>
        </div>
      )}
    </form>
  );
}
