import { describe, it, expect } from "vitest";
import {
  authIPHeaders,
  trustedAuthRequest,
  clientIPHeader,
  proxyKeyHeader,
} from "../../src/lib/auth-proxy";
const key = "synthetic-proxy-key-".repeat(3);
const production = {
  NODE_ENV: "production",
  BETTER_AUTH_URL: "https://clinic.example.com",
  AUTH_PROXY_SECRET: key,
};
const request = (headers: Record<string, string> = {}) =>
  new Request("https://clinic.example.com/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      Origin: "https://clinic.example.com",
      "content-type": "application/json",
      ...headers,
    },
    body: "{}",
  });

describe("authenticated ingress IP contract", () => {
  it("accepts a framework-proxied Request without native private-field brand errors", async () => {
    const original = request({
      [clientIPHeader]: "2001:db8:1::1",
      [proxyKeyHeader]: key,
    });
    const proxied = new Proxy(original, {
      get(target, property) {
        return Reflect.get(target, property, target);
      },
    });
    const result = trustedAuthRequest(proxied, production) as Request;
    expect(result).toBeInstanceOf(Request);
    expect(result.url).toBe(original.url);
    expect(result.method).toBe("POST");
    expect(await result.text()).toBe("{}");
    expect(result.headers.has(proxyKeyHeader)).toBe(false);
  });
  it("never selects arbitrary forwarded client headers outside local development", () => {
    expect(authIPHeaders(production)).toEqual([clientIPHeader]);
    expect(
      authIPHeaders({
        NODE_ENV: "development",
        BETTER_AUTH_URL: "https://remote.example.com",
      }),
    ).toEqual([clientIPHeader]);
    expect(
      authIPHeaders({
        NODE_ENV: "test",
        BETTER_AUTH_URL: "http://localhost:3000",
      }),
    ).toEqual(["x-forwarded-for"]);
  });
  it.each<Record<string, string>>([
    {},
    { [clientIPHeader]: "2001:db8:1::1" },
    { [clientIPHeader]: "2001:db8:1::1", [proxyKeyHeader]: "wrong" },
    { [clientIPHeader]: "2001:db8:1::1, 127.0.0.1", [proxyKeyHeader]: key },
    { [clientIPHeader]: "not-an-ip", [proxyKeyHeader]: key },
  ])(
    "rejects missing, forged or ambiguous gateway assertions",
    async (headers) => {
      const result = trustedAuthRequest(request(headers), production);
      expect(result).toBeInstanceOf(Response);
      const response = result as Response;
      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).not.toContain(key);
    },
  );
  it("fails closed if production configuration is missing even with client-supplied assertions", () => {
    expect(
      trustedAuthRequest(
        request({ [clientIPHeader]: "127.0.0.1", [proxyKeyHeader]: key }),
        { NODE_ENV: "production" },
      ),
    ).toBeInstanceOf(Response);
  });
  it("preserves body, cookies and Origin, strips spoofed IP headers and consumes the gateway key", async () => {
    const result = trustedAuthRequest(
      request({
        [clientIPHeader]: "2001:db8:1::1",
        [proxyKeyHeader]: key,
        "x-forwarded-for": "198.51.100.9",
        forwarded: "for=198.51.100.9",
        "x-real-ip": "198.51.100.8",
        "cf-connecting-ip": "198.51.100.7",
        cookie: "synthetic=session",
      }),
      production,
    ) as Request;
    expect(result).toBeInstanceOf(Request);
    expect(result.headers.get(clientIPHeader)).toBe("2001:db8:1::1");
    for (const header of [
      "x-forwarded-for",
      "forwarded",
      "x-real-ip",
      "cf-connecting-ip",
      proxyKeyHeader,
    ])
      expect(result.headers.has(header)).toBe(false);
    expect(result.headers.get("origin")).toBe(production.BETTER_AUTH_URL);
    expect(result.headers.get("cookie")).toBe("synthetic=session");
    expect(result.method).toBe("POST");
    expect(await result.text()).toBe("{}");
  });
  it("keeps local synthetic clients separate but strips private production headers", () => {
    const result = trustedAuthRequest(
      request({
        [clientIPHeader]: "198.51.100.7",
        [proxyKeyHeader]: key,
        "x-forwarded-for": "2001:db8:1::1",
      }),
      { NODE_ENV: "test", BETTER_AUTH_URL: "http://localhost:3000" },
    ) as Request;
    expect(result.headers.get("x-forwarded-for")).toBe("2001:db8:1::1");
    expect(result.headers.has(clientIPHeader)).toBe(false);
    expect(result.headers.has(proxyKeyHeader)).toBe(false);
  });
});
