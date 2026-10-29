import { z } from "zod";
import { validProxySecret } from "./auth-proxy";
import { databasePoolOptions } from "./database-options";
const schema = z.object({
  RUNTIME_DATABASE_URL: z
    .url()
    .refine(
      (v) => v.startsWith("postgresql://") || v.startsWith("postgres://"),
      "PostgreSQL URL required",
    ),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535),
  SMTP_FROM: z.email(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  AUTH_PROXY_SECRET: z.string().optional(),
});
export function readEnv(
  source: Record<string, string | undefined> = process.env,
) {
  databasePoolOptions(source);
  const result = schema.safeParse(source);
  if (!result.success)
    throw new Error(
      `Invalid environment configuration: ${result.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  if (
    source.NODE_ENV === "production" &&
    !result.data.BETTER_AUTH_URL.startsWith("https://")
  )
    throw new Error("Production authentication requires HTTPS");
  if (
    source.NODE_ENV === "production" &&
    (!result.data.SMTP_USER || !result.data.SMTP_PASSWORD)
  )
    throw new Error("Production SMTP requires authentication");
  if (
    source.NODE_ENV === "production" &&
    !validProxySecret(result.data.AUTH_PROXY_SECRET)
  )
    throw new Error(
      "Production authentication requires a valid AUTH_PROXY_SECRET",
    );
  return result.data;
}
