import { readEnv } from "../src/lib/env";
readEnv({ ...process.env, NODE_ENV: process.argv[2] ?? "development" });
console.log(
  "Required environment configuration is valid. Values are not logged.",
);
