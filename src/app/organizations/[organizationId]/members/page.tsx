import { organizationContext } from "@/modules/organizations/page-context";
import { changeMember, removeMember, revokeInvitation } from "@/app/actions";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { InviteForm } from "@/components/invite-form";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/message";
export default async function Members({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { organizationId } = await params;
  const { members, invitations, role } =
    await organizationContext(organizationId);
  const { error } = await searchParams;
  return (
    <>
      <div>
        <h1 className="text-3xl font-semibold">People & access</h1>
        <p className="mt-2 text-muted-foreground">
          Owners manage roles. Owners and administrators invite colleagues.
        </p>
      </div>
      <Message error={error} />
      <Card>
        <CardHeader>
          <CardTitle>Organization members</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="pb-3">Person</th>
                <th className="pb-3">Role</th>
                {role === "OWNER" && <th className="pb-3">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id} className="border-b">
                  <td className="py-4 pr-4">
                    <p className="font-medium">{member.user.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {member.user.email}
                    </p>
                  </td>
                  <td className="pr-4">{member.role.toLowerCase()}</td>
                  {role === "OWNER" && (
                    <td className="flex flex-wrap gap-2 py-4">
                      <form
                        className="flex gap-2"
                        action={changeMember.bind(
                          null,
                          organizationId,
                          member.userId,
                        )}
                      >
                        <select
                          name="role"
                          aria-label={`Role for ${member.user.name}`}
                          defaultValue={member.role}
                        >
                          <option value="OWNER">Owner</option>
                          <option value="ADMIN">Admin</option>
                          <option value="MEMBER">Member</option>
                          <option value="DISPLAY">Display only</option>
                        </select>
                        <Button variant="outline">Update</Button>
                      </form>
                      <form
                        action={removeMember.bind(
                          null,
                          organizationId,
                          member.userId,
                        )}
                      >
                        <Button variant="destructive">Remove</Button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {role !== "MEMBER" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Invite a colleague</CardTitle>
            </CardHeader>
            <CardContent>
              <InviteForm
                organizationId={organizationId}
                baseURL={process.env.BETTER_AUTH_URL!}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Pending invitations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {invitations.length ? (
                invitations.map((invite) => (
                  <div
                    key={invite.id}
                    className="flex items-center justify-between gap-3 border-b pb-3"
                  >
                    <div>
                      <p className="text-sm">{invite.email}</p>
                      <p className="text-xs text-muted-foreground">
                        {invite.role.toLowerCase()} · expires{" "}
                        {invite.expiresAt.toISOString().slice(0, 10)}
                      </p>
                    </div>
                    <form
                      action={revokeInvitation.bind(
                        null,
                        organizationId,
                        invite.id,
                      )}
                    >
                      <Button variant="outline">Revoke</Button>
                    </form>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No pending invitations.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
