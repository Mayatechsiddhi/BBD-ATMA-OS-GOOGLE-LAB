import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { db } from "./db";
import { sendAccountEmail } from "./mail";
import { authIPHeaders } from "./auth-proxy";
export const auth = betterAuth({
  user: { deleteUser: { enabled: false } },
  appName: "BBD Master ATMA OS",
  database: prismaAdapter(db, { provider: "postgresql" }),
  trustedOrigins: (request) => {
    const list = [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://*.run.app",
      "https://*.aistudio.google.com",
    ];
    if (process.env.BETTER_AUTH_URL) list.push(process.env.BETTER_AUTH_URL);
    if (request?.headers) {
      const origin = request.headers.get("origin") || request.headers.get("referer");
      if (origin) {
        try {
          const u = new URL(origin);
          list.push(u.origin);
        } catch {}
      }
    }
    return list;
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    requireEmailVerification: process.env.NODE_ENV === "production",
    sendResetPassword: async ({ user, url }) =>
      sendAccountEmail(user.email, "Reset your password", url),
    revokeSessionsOnPasswordReset: true,
  },
  emailVerification: {
    sendOnSignUp: process.env.NODE_ENV === "production",
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) =>
      sendAccountEmail(user.email, "Verify your email", url),
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: false },
  },
  rateLimit: { enabled: true, storage: "database", window: 60, max: 30 },
  advanced: {
    ipAddress: { ipAddressHeaders: authIPHeaders() },
    disableCSRFCheck: false,
    disableOriginCheck: true,
    useSecureCookies: process.env.NODE_ENV === "production",
  },
  plugins: [nextCookies()],
});
