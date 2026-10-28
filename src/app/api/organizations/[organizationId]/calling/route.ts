import { auth } from "@/lib/auth";
import { board } from "@/modules/calling/service";
import { AccessError } from "@/modules/organizations/policy";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const { organizationId } = await params;
  const view = new URL(request.url).searchParams.get("view") ?? "display";
  if (!["display", "reception"].includes(view))
    return new Response(null, { status: 400 });
  const permission = view === "reception" ? "read" : "display:read";
  const initialSession = await auth.api.getSession({
    headers: request.headers,
  });
  if (!initialSession)
    return new Response(null, {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  let initial;
  try {
    initial = await board(initialSession.user.id, organizationId, permission);
  } catch (e) {
    return new Response(null, {
      status: e instanceof AccessError ? 403 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let timer: ReturnType<typeof setTimeout>;
      const close = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        request.signal.removeEventListener("abort", close);
        controller.close();
      };
      stop = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        request.signal.removeEventListener("abort", close);
      };
      const send = (event: string, data: unknown) => {
        if (!closed)
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
      };
      request.signal.addEventListener("abort", close, { once: true });
      if (request.signal.aborted) {
        close();
        return;
      }
      const started = Date.now();
      send("queue", initial);
      const tick = async () => {
        if (closed) return;
        try {
          // Recheck both the session and membership on every snapshot. No long
          // database transaction is held between ticks or across reconnects.
          const session = await auth.api.getSession({
            headers: request.headers,
          });
          if (!session) throw new AccessError();
          const snapshot = await board(
            session.user.id,
            organizationId,
            permission,
          );
          send("queue", snapshot);
          if (Date.now() - started >= 30000) {
            close();
            return;
          }
          if (!closed) timer = setTimeout(tick, 2000);
        } catch {
          send("unavailable", {});
          close();
        }
      };
      timer = setTimeout(tick, 2000);
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "private, no-store, no-transform",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
