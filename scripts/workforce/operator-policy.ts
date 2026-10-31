import { isIP } from "node:net";
export function operatorConfig(
  env: Readonly<Record<string, string | undefined>>,
) {
  if (env.NODE_ENV === "production" || env.BBD_WORKFORCE_OPERATOR_LOCAL !== "1")
    throw Error("Explicit local-only operator opt-in required");
  for (const key of [
    "DATABASE_URL",
    "RUNTIME_DATABASE_URL",
    "TEST_DATABASE_URL",
    "TEST_RUNTIME_DATABASE_URL",
    "WORKFORCE_TEST_DATABASE_URL",
    "WORKFORCE_MIGRATION_DATABASE_URL",
  ])
    if (env[key])
      throw Error("Operator must not receive customer or owner credentials");
  const origin = new URL(env.WORKFORCE_AUTH_URL ?? "");
  const db = new URL(env.WORKFORCE_RUNTIME_DATABASE_URL ?? "");
  if (
    origin.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(origin.hostname) ||
    !origin.port ||
    origin.port === "3000" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    !["postgres:", "postgresql:"].includes(db.protocol) ||
    [...db.searchParams].some(
      ([key, value]) => key !== "schema" || value !== "public",
    ) ||
    !["localhost", "127.0.0.1"].includes(db.hostname) ||
    !/^\/bbd_workforce_[a-z0-9_]+_test$/.test(db.pathname)
  )
    throw Error(
      "Loopback origin and isolated synthetic workforce test database required",
    );
  return {
    origin: origin.origin,
    port: Number(origin.port),
    host: origin.host,
  };
}
export function safeRequest(
  headers: Record<string, string | string[] | undefined>,
  remote: string | undefined,
  host: string,
  origin: string,
) {
  if (
    !remote ||
    !isIP(remote) ||
    !["127.0.0.1", "::ffff:127.0.0.1", "::1"].includes(remote)
  )
    return false;
  if (headers.host !== host || headers["sec-fetch-site"] === "cross-site")
    return false;
  if (headers.origin && headers.origin !== origin) return false;
  return !Object.keys(headers).some((k) =>
    /^(forwarded|x-forwarded-|x-real-ip|x-bbd-|x-user-|x-role)/i.test(k),
  );
}
