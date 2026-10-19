import fs from "node:fs";
import { randomBytes } from "node:crypto";
if (fs.existsSync(".env")) {
  console.log(
    "Existing .env preserved. Check required names against .env.example.",
  );
} else {
  const password = randomBytes(24).toString("hex");
  const values = {
    DATABASE_URL: `postgresql://bbd:${password}@127.0.0.1:5432/bbd?schema=public`,
    TEST_DATABASE_URL: `postgresql://bbd:${password}@127.0.0.1:5432/bbd_test?schema=public`,
    POSTGRES_PASSWORD: password,
    BETTER_AUTH_SECRET: randomBytes(48).toString("hex"),
    BETTER_AUTH_URL: "http://localhost:3000",
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "1025",
    SMTP_FROM: "accounts@bbd.local",
  };
  fs.writeFileSync(
    ".env",
    Object.entries(values)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join("\n") + "\n",
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    "Created ignored .env with fresh local-only secrets. Values are not logged.",
  );
}
