import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { databasePoolOptions } from "./database-options";
if (!process.env.RUNTIME_DATABASE_URL)
  throw new Error(
    "RUNTIME_DATABASE_URL is required; migration credentials must not be used by the app",
  );
const globalDb = globalThis as unknown as { db?: PrismaClient };
export const db =
  globalDb.db ??
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.RUNTIME_DATABASE_URL,
      ...databasePoolOptions(),
    }),
  });
if (process.env.NODE_ENV !== "production") globalDb.db = db;
