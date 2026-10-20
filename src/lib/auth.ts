import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { db } from "./db";
import { sendAccountEmail } from "./mail";
export const auth = betterAuth({
  user: { deleteUser: { enabled: false } },
  appName: "BBD Master ATMA OS",
  database: prismaAdapter(db, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) =>
      sendAccountEmail(user.email, "Reset your password", url),
    revokeSessionsOnPasswordReset: true,
  },
  emailVerification: {
    sendOnSignUp: true,
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
    disableCSRFCheck: false,
    disableOriginCheck: false,
    useSecureCookies: process.env.NODE_ENV === "production",
  },
  plugins: [nextCookies()],
});
