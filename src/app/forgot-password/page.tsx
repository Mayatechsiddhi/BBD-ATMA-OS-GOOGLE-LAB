import Link from "next/link";
import { PasswordForm } from "@/components/password-form";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <main className="mx-auto max-w-md space-y-6 p-10">
      <h1 className="text-2xl font-semibold">Password recovery</h1>
      <PasswordForm token={token} />
      <Link className="block text-sm text-primary underline" href="/sign-in">
        Return to sign in
      </Link>
    </main>
  );
}
