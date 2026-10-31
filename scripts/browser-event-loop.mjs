// Opt-in fixture preload only. Never imported by application source.
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import fs from "node:fs";
const file = process.env.BBD_BROWSER_EVENT_LOOP_FILE;
if (file) {
  if (!file.startsWith("/tmp/bbd-browser-"))
    throw Error("Private diagnostic path required");
  const h = monitorEventLoopDelay({ resolution: 20 });
  h.enable();
  let previous = performance.eventLoopUtilization();
  const timer = setInterval(() => {
    const current = performance.eventLoopUtilization();
    const delta = performance.eventLoopUtilization(current, previous);
    previous = current;
    fs.appendFileSync(
      file,
      JSON.stringify({
        at: new Date().toISOString(),
        pid: process.pid,
        eventLoopMaxMs: Number(h.max) / 1e6,
        eventLoopMeanMs: Number.isFinite(h.mean) ? h.mean / 1e6 : null,
        utilization: delta.utilization,
        rssBytes: process.memoryUsage().rss,
      }) + "\n",
      { mode: 0o600 },
    );
    h.reset();
  }, 1000);
  timer.unref();
}
