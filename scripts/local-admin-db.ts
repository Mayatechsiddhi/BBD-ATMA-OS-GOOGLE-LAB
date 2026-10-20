// Fixture inspection/cleanup only. Never imported by src/ application code.
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const source = process.env.DATABASE_URL;
if (!source || !["localhost", "127.0.0.1"].includes(new URL(source).hostname))
  throw new Error("Administrative fixture access is local-only");
export const adminDb = new PrismaClient({
  adapter: new PrismaPg({ connectionString: source }),
});
