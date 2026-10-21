"use client";
import { createAuthClient } from "better-auth/react";
import { useState } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
const client = createAuthClient();
export function PasswordForm({ token }: { token?: string }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const hydrated = useHydrated();
  return (
    <form
      method="post"
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const data = new FormData(e.currentTarget);
        try {
          if (token) {
            const result = await client.resetPassword({
              newPassword: String(data.get("password")),
              token,
            });
            setMessage(
              result.error
                ? "Unable to reset password. Request a new link."
                : "Password reset. You can now sign in.",
            );
          } else {
            await client.requestPasswordReset({
              email: String(data.get("email")),
              redirectTo: "/reset-password",
            });
            setMessage(
              "If the account exists, a reset email will arrive shortly.",
            );
          }
        } catch {
          setMessage("Unable to reach the service. Please try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {token ? (
        <label>
          New password
          <Input
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
          />
        </label>
      ) : (
        <label>
          Email address
          <Input name="email" type="email" autoComplete="email" required />
        </label>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      <Button disabled={busy || !hydrated}>
        {busy ? "Please wait…" : token ? "Reset password" : "Send reset link"}
      </Button>
    </form>
  );
}
