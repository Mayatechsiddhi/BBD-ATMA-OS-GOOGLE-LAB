import Link from "next/link";
export default function NotFound() {
  return (
    <main className="p-12">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link className="underline" href="/organizations">
        Return to organizations
      </Link>
    </main>
  );
}
