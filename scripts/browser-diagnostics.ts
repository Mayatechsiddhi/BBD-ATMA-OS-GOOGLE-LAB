import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import type { BrowserContext } from "playwright-core";

/** Opt-in local-only artifacts. Traces contain synthetic sessions: never publish raw. */
export async function browserDiagnostics(
  context: BrowserContext,
  directory: string | undefined,
  label: string,
) {
  if (!directory) return async () => {};
  if (!directory.startsWith("/tmp/bbd-browser-"))
    throw new Error("Private temporary browser artifact directory required");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const events: object[] = [];
  const clean = (value: string) =>
    value
      .replace(/https?:\/\/[^\s"'<>]+/g, (url) => {
        try {
          const parsed = new URL(url);
          return parsed.origin + parsed.pathname;
        } catch {
          return "[URL]";
        }
      })
      .replace(/Browser-[a-f0-9-]+!/gi, "[PASSWORD]")
      .replace(/\b[a-f0-9]{32,}\b/gi, "[TOKEN]")
      .replace(/[^\s@]+@[^\s@]+/g, "[EMAIL]");
  const record = (kind: string, detail: object) =>
    events.push({ at: Date.now(), kind, ...detail });
  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: true,
  });
  context.on("page", (page) => {
    void context
      .newCDPSession(page)
      .then(async (session) => {
        await session.send("Network.enable");
        session.on("Network.eventSourceMessageReceived", (event) => {
          let calls: unknown;
          if (event.eventName === "queue") {
            try {
              const snapshot = JSON.parse(event.data);
              calls = snapshot.doctors?.map(
                (doctor: {
                  current?: { number: number; callCount: number };
                }) =>
                  doctor.current
                    ? {
                        number: doctor.current.number,
                        calls: doctor.current.callCount,
                      }
                    : null,
              );
            } catch {
              calls = "unparsed";
            }
          }
          record("sse", { event: event.eventName, calls });
        });
      })
      .catch(() => record("cdp-unavailable", {}));
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type()))
        record("console", {
          level: message.type(),
          message: clean(message.text()),
        });
    });
    page.on("pageerror", (error) =>
      record("pageerror", { message: clean(error.message) }),
    );
    page.on("requestfailed", (request) =>
      record("requestfailed", {
        path: clean(request.url()),
        type: request.resourceType(),
        error: clean(request.failure()?.errorText ?? "unknown"),
      }),
    );
    page.on("response", (response) => {
      const request = response.request();
      if (
        response.status() >= 400 ||
        ["script", "document"].includes(request.resourceType())
      )
        record("response", {
          path: clean(response.url()),
          type: request.resourceType(),
          status: response.status(),
          timing: request.timing(),
        });
    });
  });
  return async () => {
    for (const [index, page] of context.pages().entries()) {
      if (page.isClosed()) continue;
      try {
        await page.screenshot({
          path: `${directory}/${label}-${index}.png`,
          mask: [page.locator("input")],
          timeout: 5000,
        });
        record(
          "page-state",
          await page.evaluate(() => ({
            path: location.pathname,
            readyState: document.readyState,
            hydratedForms: document.querySelectorAll(
              'form[data-hydrated="true"]',
            ).length,
            statuses: [...document.querySelectorAll('[role="status"]')].map(
              (x) => x.textContent?.slice(0, 200),
            ),
          })),
        );
      } catch {
        record("capture-unavailable", { index });
      }
    }
    await context.tracing.stop({ path: `${directory}/${label}.zip` });
    writeFileSync(
      `${directory}/${label}.json`,
      JSON.stringify(events, null, 2),
      { mode: 0o600 },
    );
    chmodSync(`${directory}/${label}.zip`, 0o600);
  };
}

/** Dev hot reload can reset UI state mid-assertion. A mutated checkout cannot
 * establish a clean browser result, even when all assertions happened to pass.
 */
export function browserSourceGuard() {
  const snapshot = () =>
    new Map(
      execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
        encoding: "utf8",
      })
        .split("\0")
        .filter(Boolean)
        .map((path) => {
          const stat = statSync(path);
          return [path, `${stat.mtimeMs}:${stat.size}`] as const;
        }),
    );
  const before = snapshot();
  return () => {
    const after = snapshot();
    const changed = [...new Set([...before.keys(), ...after.keys()])].filter(
      (path) => before.get(path) !== after.get(path),
    );
    if (changed.length)
      throw new Error(
        "Browser checkout changed during execution: " + changed.join(", "),
      );
  };
}
