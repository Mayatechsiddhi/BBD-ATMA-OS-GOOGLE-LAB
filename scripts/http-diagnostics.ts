// Test-runner diagnostics only. Never log URLs, queries, bodies, cookies,
// headers, response contents or exception messages (including fetch causes).
const segments = new Set([
  "api",
  "health",
  "auth",
  "sign-up",
  "sign-in",
  "email",
  "sign-out",
  "verify-email",
  "organizations",
  "settings",
  "members",
  "modules",
  "crm",
  "opportunities",
  "clinic",
  "leads",
  "appointments",
  "follow-ups",
  "schedules",
  "reception",
  "invitations",
  "calling",
  "display",
]);
let sequence = 0;
export async function diagnoseHttpRequest(
  method: string,
  path: string,
  run: () => Promise<Response>,
  emit: (line: string) => void = (line) => console.error(line),
) {
  const requestId = ++sequence;
  const route = path
    .split(/[?#]/, 1)[0]
    .split("/")
    .slice(0, 8)
    .map((part) => (segments.has(part) ? part : part === "" ? "" : ":id"))
    .join("/");
  const verb = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].includes(
    method,
  )
    ? method
    : "OTHER";
  const started = performance.now();
  const log = (stage: string, extra = {}) =>
    emit(
      JSON.stringify({
        kind: "http-smoke-stage",
        requestId,
        method: verb,
        route,
        stage,
        elapsedMs: Math.round(performance.now() - started),
        ...extra,
      }),
    );
  log("dispatch");
  try {
    const response = await run();
    log("headers", { status: response.status });
    // Preserve native body consumption/errors, but identify whether a later
    // failure occurred during text/JSON consumption rather than fetch headers.
    async function body<T>(kind: "text" | "json", consume: () => Promise<T>) {
      log(`body-${kind}-start`);
      try {
        const value = await consume();
        log(`body-${kind}-end`);
        return value;
      } catch (error) {
        log(`body-${kind}-failed`);
        throw error;
      }
    }
    const text = response.text.bind(response);
    const json = response.json.bind(response);
    response.text = () => body("text", text);
    response.json = () => body("json", json);
    return response;
  } catch (error) {
    log("failed", {
      category:
        error instanceof Error &&
        ["TimeoutError", "AbortError"].includes(error.name)
          ? error.name
          : "REQUEST_FAILED",
    });
    throw error;
  }
}
