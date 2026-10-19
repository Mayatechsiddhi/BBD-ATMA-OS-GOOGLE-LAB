"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl space-y-4 p-12">
      <h1 className="text-2xl font-semibold">
        Unable to complete this request
      </h1>
      <p className="text-muted-foreground">
        Please try again. If the issue continues, contact your administrator.
      </p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
