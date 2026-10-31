import { readFileSync } from "node:fs";
import { isIP } from "node:net";
/** Per-client fixture credential, never the real gateway key. Only a loopback test
 * gateway can resolve this credential to its server-owned IP identity. */
export function fixtureClientHeaders(ip: string): Record<string, string> {
  const file = process.env.BROWSER_GATEWAY_CLIENTS_FILE;
  if (!file) return { "x-forwarded-for": ip }; // preserved local-development runner
  if (!file.startsWith("/tmp/bbd-browser-") || !isIP(ip))
    throw Error("Invalid private fixture identity");
  const registry = JSON.parse(readFileSync(file, "utf8")) as Record<
    string,
    string
  >;
  const normalized = ip.replace(/::[a-f0-9]+$/i, "::1");
  const token = registry[normalized];
  if (!token || !/^[a-f0-9]{64}$/.test(token))
    throw Error("Unregistered fixture client");
  return { "x-bbd-fixture-client": token, "x-forwarded-for": ip };
}
