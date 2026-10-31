import { defineConfig } from "prisma/config";
// Separate offline migration process only, never supplied to runtime workers.
export default defineConfig({
  schema: "workforce/schema.prisma",
  migrations: { path: "workforce/migrations" },
  datasource: { url: process.env.WORKFORCE_MIGRATION_DATABASE_URL },
});
