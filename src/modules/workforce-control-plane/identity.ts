import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import type { PrismaClient } from "@/generated/workforce/client";
export function workforceIdentity(db: PrismaClient) {
  const secret = process.env.WORKFORCE_AUTH_SECRET;
  const baseURL = process.env.WORKFORCE_AUTH_URL;
  if (
    !secret ||
    secret.length < 32 ||
    secret === process.env.BETTER_AUTH_SECRET ||
    !baseURL ||
    baseURL === process.env.BETTER_AUTH_URL
  )
    throw new Error("Separate workforce auth secret and origin required");
  const origin = new URL(baseURL);
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/" ||
    (origin.protocol !== "https:" &&
      !(
        process.env.NODE_ENV !== "production" &&
        origin.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(origin.hostname)
      )) ||
    (process.env.BETTER_AUTH_URL &&
      origin.origin === new URL(process.env.BETTER_AUTH_URL).origin)
  )
    throw new Error("Isolated workforce auth origin required");
  return betterAuth({
    secret,
    baseURL,
    basePath: "/internal/auth",
    appName: "BBD Internal Workforce",
    database: prismaAdapter(db, { provider: "postgresql" }),
    user: { deleteUser: { enabled: false } },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: 3600,
      updateAge: 300,
      cookieCache: { enabled: false },
    },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 10 },
    advanced: {
      cookiePrefix: "bbd-workforce",
      useSecureCookies: process.env.NODE_ENV === "production",
      disableCSRFCheck: false,
      disableOriginCheck: false,
      ipAddress: { ipAddressHeaders: ["x-bbd-client-ip"] },
    },
  });
}
