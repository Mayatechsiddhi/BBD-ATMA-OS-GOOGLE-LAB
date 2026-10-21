"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { createAuthClient } from "better-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useHydrated } from "@/lib/use-hydrated";
const client = createAuthClient();
export function AuthForm({ signup = false }: { signup?: boolean }) {
  const router = useRouter();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const hydrated = useHydrated();
  return (
    <form
      method="post"
      className="space-y-5"
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        setBusy(true);
        const data = new FormData(event.currentTarget);
        try {
          const credentials = {
            email: String(data.get("email")),
            password: String(data.get("password")),
          };
          const result = signup
            ? await client.signUp.email({
                ...credentials,
                name: String(data.get("name")),
                callbackURL: "/organizations",
              })
            : await client.signIn.email(credentials);
          if (result.error) {
            setError(
              signup
                ? "Unable to create account. Check your details or sign in."
                : "Unable to sign in. Check your email and password.",
            );
          } else if (signup) {
            setNotice(
              "Check your email to verify your account before signing in.",
            );
          } else {
            router.push("/organizations");
            router.refresh();
          }
        } catch {
          setError("Unable to reach the authentication service.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {signup && (
        <label>
          Full name
          <Input
            name="name"
            autoComplete="name"
            required
            minLength={2}
            maxLength={100}
          />
        </label>
      )}
      <label>
        Email address
        <Input
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
        />
      </label>
      <label>
        Password
        <Input
          name="password"
          type="password"
          autoComplete={signup ? "new-password" : "current-password"}
          required
          minLength={12}
          maxLength={128}
        />
      </label>
      {signup && (
        <p className="text-xs text-muted-foreground">
          Use at least 12 characters. Invitations must match your account email.
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-primary">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button className="w-full" disabled={busy || !hydrated}>
        {busy ? "Please wait…" : signup ? "Create account" : "Sign in"}
      </Button>
      <Link
        className="block text-sm text-primary underline"
        href="/forgot-password"
      >
        Forgot your password?
      </Link>
      <p className="text-sm text-muted-foreground">
        {signup ? "Already registered?" : "New to BBD?"}{" "}
        <Link
          className="font-medium text-primary underline"
          href={signup ? "/sign-in" : "/sign-up"}
        >
          {signup ? "Sign in" : "Create account"}
        </Link>
      </p>
    </form>
  );
}
