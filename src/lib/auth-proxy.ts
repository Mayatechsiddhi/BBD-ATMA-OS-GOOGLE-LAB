import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export const clientIPHeader = "x-bbd-client-ip";
export const proxyKeyHeader = "x-bbd-auth-proxy-key";
type Environment = Record<string, string | undefined>;

function localDevelopment(source: Environment) {
  if (source.NODE_ENV === "production") return false;
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(source.BETTER_AUTH_URL ?? "").hostname,
    );
  } catch {
    return false;
  }
}

export function validProxySecret(value: string | undefined): value is string {
  return typeof value === "string" && /^[!-~]{32,128}$/.test(value);
}

export function authIPHeaders(source: Environment = process.env) {
  // Only local synthetic tests may simulate independent clients through XFF.
  return localDevelopment(source) ? ["x-forwarded-for"] : [clientIPHeader];
}

/** Only a separately configured trusted gateway may supply production client IPs.
 * The gateway must overwrite BOTH headers, keep its key server-side and use TLS.
 * This application contract does not attest a real deployment's ingress setup.
 */
export function trustedAuthRequest(
  request: Request,
  source: Environment = process.env,
): Request | Response {
  const headers = new Headers(request.headers);
  if (!localDevelopment(source)) {
    const expected = source.AUTH_PROXY_SECRET;
    const supplied = headers.get(proxyKeyHeader) ?? "";
    const ip = headers.get(clientIPHeader) ?? "";
    const digest = (value: string) =>
      createHash("sha256").update(value).digest();
    if (
      !validProxySecret(expected) ||
      !isIP(ip) ||
      !timingSafeEqual(digest(expected), digest(supplied))
    )
      return Response.json(
        { error: "Authentication gateway unavailable." },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    for (const name of [
      "x-forwarded-for",
      "x-real-ip",
      "forwarded",
      "cf-connecting-ip",
    ])
      headers.delete(name);
  } else {
    headers.delete(clientIPHeader);
  }
  // Never forward the gateway credential into Better Auth or its session data.
  headers.delete(proxyKeyHeader);
  // Next can pass a proxied NextRequest. Passing that object to undici's
  // Request constructor trips native private-field brand checks. Reconstruct
  // from the public Web API fields, forwarding the body stream only once.
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    signal: request.signal,
    ...(request.method !== "GET" && request.method !== "HEAD"
      ? { body: request.body, duplex: "half" as const }
      : {}),
  };
  return new Request(request.url, init);
}
