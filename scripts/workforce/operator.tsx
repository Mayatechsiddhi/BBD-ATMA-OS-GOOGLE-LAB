import { createServer, type IncomingMessage } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createWorkforceReader } from "../../src/modules/workforce-control-plane/reader";
import { operatorConfig, safeRequest } from "./operator-policy";
import { operatorPage } from "./operator-view";

function builtCss() {
  const dir = path.resolve(".next/static");
  if (!fs.existsSync(dir))
    throw Error("Run npm run build before starting the local operator");
  const files = fs
    .readdirSync(dir, { recursive: true })
    .filter((f): f is string => typeof f === "string" && f.endsWith(".css"));
  if (!files.length) throw Error("Built BBD stylesheet missing");
  return files
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
    .join("\n");
}
async function body(req: IncomingMessage) {
  let text = "";
  for await (const chunk of req) {
    text += chunk.toString();
    if (Buffer.byteLength(text) > 2048) throw Error("INVALID");
  }
  return new URLSearchParams(text);
}
export async function startOperator() {
  const config = operatorConfig(process.env);
  const css = builtCss();
  const reader = await createWorkforceReader();
  const server = createServer(
    { maxHeaderSize: 8192, requestTimeout: 10000, headersTimeout: 5000 },
    async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      );
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "DENY");
      // Chromium serializes same-origin form POST Origin as null under no-referrer.
      // Keep same-origin CSRF validation intact without sending cross-origin referrers.
      res.setHeader("Referrer-Policy", "same-origin");
      const send = (status: number, html: string) => {
        res.statusCode = status;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(html);
      };
      try {
        const seen = new Set<string>();
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          const k = req.rawHeaders[i].toLowerCase();
          if (seen.has(k)) {
            send(400, "Invalid request");
            return;
          }
          seen.add(k);
        }
        if (
          !safeRequest(
            req.headers,
            req.socket.remoteAddress,
            config.host,
            config.origin,
          )
        ) {
          send(403, "Access denied");
          return;
        }
        const url = new URL(req.url ?? "/", config.origin);
        if (url.origin !== config.origin || url.href.length > 1024) {
          send(400, "Invalid request");
          return;
        }
        if (req.method === "GET" && url.pathname === "/assets/operator.css") {
          res.setHeader("Content-Type", "text/css; charset=utf-8");
          res.end(css);
          return;
        }
        if (url.pathname === "/sign-in") {
          if (req.method === "GET") {
            const nonce = randomBytes(32).toString("hex");
            res.setHeader(
              "Set-Cookie",
              `bbd-operator-csrf=${nonce}; HttpOnly; SameSite=Strict; Path=/sign-in`,
            );
            send(200, operatorPage({ nonce }));
            return;
          }
          if (req.method !== "POST") {
            send(405, "Method not allowed");
            return;
          }
          if (
            req.headers.origin !== config.origin ||
            req.headers["content-type"] !== "application/x-www-form-urlencoded"
          ) {
            send(403, "Access denied");
            return;
          }
          const fields = await body(req);
          if (
            [...fields.keys()].length !== 3 ||
            !["csrf", "email", "password"].every(
              (k) => fields.getAll(k).length === 1,
            )
          ) {
            send(400, "Invalid sign in");
            return;
          }
          const csrf = fields.get("csrf")!;
          const cookies = (req.headers.cookie ?? "")
            .split(/;\s*/)
            .filter((x) => x.startsWith("bbd-operator-csrf="));
          const expected =
            cookies.length === 1
              ? cookies[0].slice("bbd-operator-csrf=".length)
              : "";
          if (
            !/^[a-f0-9]{64}$/.test(csrf) ||
            !expected ||
            csrf.length !== expected.length ||
            !timingSafeEqual(Buffer.from(csrf), Buffer.from(expected))
          ) {
            send(403, "Access denied");
            return;
          }
          const email = fields.get("email")!,
            password = fields.get("password")!;
          if (
            email.length > 254 ||
            !email.includes("@") ||
            password.length < 12 ||
            password.length > 128
          ) {
            send(400, "Invalid sign in");
            return;
          }
          const auth = await reader.signIn(
            new Headers({
              origin: config.origin,
              "x-bbd-client-ip": req.socket.remoteAddress!,
            }),
            email,
            password,
          );
          if (auth.status !== 200) {
            send(
              auth.status === 429 ? 429 : 401,
              operatorPage({
                error:
                  "Sign in unavailable or credentials invalid. Return to sign in to retry.",
              }),
            );
            return;
          }
          res.setHeader("Set-Cookie", [
            ...auth.headers.getSetCookie(),
            "bbd-operator-csrf=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/sign-in",
          ]);
          res.writeHead(303, { Location: "/" });
          res.end();
          return;
        }
        if (req.method !== "GET") {
          send(405, "Method not allowed");
          return;
        }
        if (url.pathname !== "/") {
          send(404, "Not found");
          return;
        }
        if (
          [...url.searchParams.keys()].some(
            (k) =>
              !["company", "task", "after"].includes(k) ||
              url.searchParams.getAll(k).length !== 1,
          )
        ) {
          send(400, "Invalid scope");
          return;
        }
        const companyId = url.searchParams.get("company");
        if (!companyId) {
          send(200, operatorPage());
          return;
        }
        try {
          const snapshot = await reader.snapshot(
            new Headers({ cookie: req.headers.cookie ?? "" }),
            {
              companyId,
              ...(url.searchParams.has("task")
                ? { taskId: url.searchParams.get("task") }
                : {}),
              ...(url.searchParams.has("after")
                ? { after: url.searchParams.get("after") }
                : {}),
            },
          );
          send(200, operatorPage({ snapshot }));
        } catch {
          send(
            404,
            operatorPage({
              error:
                "Scope unavailable or access denied. Sign in with an authorized workforce account.",
            }),
          );
        }
      } catch {
        send(400, "Request could not be completed");
      }
    },
  );
  server.maxConnections = 20;
  server.keepAliveTimeout = 2000;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.port, "127.0.0.1", resolve);
    });
  } catch (error) {
    await reader.close();
    throw error;
  }
  return {
    url: config.origin,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
      await reader.close();
    },
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  startOperator()
    .then((operator) => {
      console.log(`Local read-only workforce operator: ${operator.url}`);
      for (const signal of ["SIGTERM", "SIGINT"] as const)
        process.once(signal, () => {
          void operator.close().then(() => process.exit(0));
        });
    })
    .catch(() => {
      console.error(
        "Local operator startup failed. Check isolated runtime configuration and build artifacts privately.",
      );
      process.exitCode = 1;
    });
}
