import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  logging: {
    // Next's default development traces include useActionState's previous token.
    serverFunctions: false,
    browserToTerminal: false,
    incomingRequests: {
      ignore: [
        /\/api\/auth\/(verify-email|reset-password)/,
        /\/reset-password/,
        // Clinic search URLs may contain phone numbers or names.
        /\/organizations\/[^/]+\/clinic(?:\/|\?|$)/,
      ],
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          // Native same-origin form POSTs need a non-null Origin for Next's CSRF check.
          // Cross-origin navigation still sends no referrer (including private paths).
          { key: "Referrer-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline'" +
              (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "") +
              "; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
          },
        ],
      },
    ];
  },
};
export default config;
