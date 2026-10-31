import fs from "node:fs";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
const image =
  "axllent/mailpit:v1.29.2@sha256:030f06031ce5c60913ac9363da1ab0d4be6fd2a78147dd0e1ca0fcac665d6b34";
function cmd(bin, args) {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  if (r.status !== 0)
    throw Error(
      `Isolated browser ${bin} command failed; private details suppressed`,
    );
  return r.stdout;
}
/** Reuse installed Chromium/libraries read-only. No image download, global trust
 * mutation or HOME override. The image entrypoint is Chromium, never Mailpit. */
export async function startFixtureChromium(dir, ca, run) {
  assert.match(dir, /^\/tmp\/bbd-browser-precompiled-[a-zA-Z0-9]+$/);
  const db = `${dir}/nssdb`;
  fs.mkdirSync(db, { mode: 0o700, recursive: true });
  if (!fs.existsSync(`${db}/cert9.db`))
    cmd("certutil", ["-N", "--empty-password", "-d", `sql:${db}`]);
  cmd("certutil", [
    "-A",
    "-d",
    `sql:${db}`,
    "-n",
    `bbd-fixture-${run}`,
    "-t",
    "C,,",
    "-i",
    ca,
  ]);
  cmd("docker", ["image", "inspect", image]);
  const name = `bbd-browser-chromium-${run}`;
  const args = [
    "create",
    "--name",
    name,
    "--entrypoint",
    "/usr/lib/chromium/chromium",
    "--user",
    `${process.getuid()}:${process.getgid()}`,
    "--env",
    "XDG_DATA_HOME=/tmp/bbd-xdg",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--network",
    "host",
    "--tmpfs",
    "/tmp",
  ];
  for (const [source, target, readonly] of [
    ["/usr", "/usr", true],
    ["/lib", "/lib", true],
    ["/lib64", "/lib64", true],
    ["/etc/fonts", "/etc/fonts", true],
    ["/etc/ssl/certs", "/etc/ssl/certs", true],
    [db, "/tmp/bbd-xdg/pki/nssdb", false],
    [db, db, false],
  ])
    args.push(
      "--mount",
      `type=bind,source=${source},target=${target}${readonly ? ",readonly" : ""}`,
    );
  args.push(
    image,
    "--headless",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--no-first-run",
    "--no-default-browser-check",
    "--user-data-dir=/tmp/bbd-profile",
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=9223",
    "about:blank",
  );
  // --no-sandbox matches Playwright's existing default chromiumSandbox:false.
  // Read-only container/capability restrictions add isolation; no TLS bypass flag.
  cmd("docker", args);
  let started = false;
  try {
    cmd("docker", ["start", name]);
    started = true;
    fs.writeFileSync(
      `${dir}/chromium-home-${run}.txt`,
      cmd("docker", ["exec", name, "/usr/bin/printenv", "HOME"]),
      { mode: 0o600 },
    );
    for (let i = 0; i < 40; i++) {
      try {
        const r = await fetch("http://127.0.0.1:9223/json/version", {
          signal: AbortSignal.timeout(1000),
        });
        if (r.status === 200)
          return {
            url: "http://127.0.0.1:9223",
            close: () => {
              const logs = spawnSync("docker", ["logs", name], {
                encoding: "utf8",
              });
              const log = logs.stdout + logs.stderr;
              fs.writeFileSync(`${dir}/chromium-${run}.log`, log, {
                mode: 0o600,
              });
              return cmd("docker", ["rm", "-f", name]);
            },
          };
      } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
    throw Error("Isolated Chromium readiness failed");
  } catch (e) {
    if (started || name) cmd("docker", ["rm", "-f", name]);
    throw e;
  }
}
