"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Board } from "@/modules/calling/service";
export function CallingLive({
  org,
  display = false,
}: {
  org: string;
  display?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<Board | null>(null);
  useEffect(() => {
    let revision = "";
    let last = 0;
    const source = new EventSource(
      `/api/organizations/${encodeURIComponent(org)}/calling?view=${display ? "display" : "reception"}`,
    );
    const unavailable = () => {
      setState(null);
      if (!display) router.refresh();
    };
    source.addEventListener("queue", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as Board;
      last = Date.now();
      setState(data);
      if (!display && revision && revision !== data.revision) router.refresh();
      revision = data.revision;
    });
    source.addEventListener("unavailable", unavailable);
    source.onerror = unavailable;
    const stale = setInterval(() => {
      if (last && Date.now() - last > 7000) unavailable();
    }, 1000);
    return () => {
      clearInterval(stale);
      source.close();
    };
  }, [org, display, router]);
  if (!state)
    return (
      <p role="status" className="rounded-xl border border-amber-400 p-5">
        Connecting or access unavailable. Calls are hidden until the live
        connection is restored.
      </p>
    );
  if (!display)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Live queue connected · {state.day} (IST)
      </p>
    );
  return (
    <section aria-label="Live calling board" className="space-y-6">
      <p className="text-sm text-emerald-200">
        Live · {state.day} · Asia/Kolkata
      </p>
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {state.doctors.map((d) => (
          <article
            key={d.id}
            className="rounded-2xl border border-white/20 p-6 break-words"
            aria-label={d.name}
          >
            <h2 className="text-2xl font-semibold">{d.name}</h2>
            <p className="mt-2 text-xl">Room {d.room}</p>
            <div aria-live="polite" aria-atomic="true" className="my-8">
              <p className="uppercase tracking-widest">Now calling</p>
              <p
                className="text-7xl font-bold tabular-nums"
                data-testid={`calling-${d.id}`}
              >
                {d.current ? String(d.current.number).padStart(3, "0") : "—"}
              </p>
              {d.current && <p>Call {d.current.callCount}</p>}
            </div>
            <p>
              Next:{" "}
              {d.next.length
                ? d.next.map((n) => String(n).padStart(3, "0")).join(" · ")
                : "No waiting tokens"}
            </p>
          </article>
        ))}
      </div>
      {!state.doctors.length && <p>No doctor queues configured.</p>}
    </section>
  );
}
