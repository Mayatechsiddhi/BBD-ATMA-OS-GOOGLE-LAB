/* eslint-disable @typescript-eslint/no-explicit-any */
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { databasePoolOptions } from "./database-options";
import { inMemoryDb } from "./in-memory-db";

const globalDb = globalThis as unknown as { db?: any };

let dbIsOffline = false;

function isConnectionError(err: any): boolean {
  return Boolean(
    err?.message?.includes("Can't reach database server") ||
    err?.message?.includes("DatabaseNotReachable") ||
    err?.code === "P2010" ||
    err?.code === "P1001" ||
    err?.meta?.driverAdapterError
  );
}

function createFallbackDb() {
  if (!process.env.RUNTIME_DATABASE_URL) {
    return inMemoryDb as unknown as PrismaClient;
  }

  let realClient: PrismaClient | null = null;
  try {
    realClient = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: process.env.RUNTIME_DATABASE_URL,
        ...databasePoolOptions(),
      }),
    });
  } catch (e) {
    console.warn("[db] Failed to instantiate PrismaPg adapter, using inMemoryDb fallback:", e);
    return inMemoryDb as unknown as PrismaClient;
  }

  // Create a transparent proxy that delegates to realClient, and falls back to inMemoryDb on connection errors
  return new Proxy(realClient, {
    get(target, prop, receiver) {
      if (dbIsOffline) {
        const fallbackVal = (inMemoryDb as any)[prop];
        if (typeof fallbackVal === "function") {
          return fallbackVal.bind(inMemoryDb);
        }
        return fallbackVal;
      }

      const val = Reflect.get(target, prop, receiver);

      if (typeof val === "function") {
        return async function (...args: any[]) {
          try {
            return await val.apply(target, args);
          } catch (err: any) {
            if (isConnectionError(err)) {
              dbIsOffline = true;
              const fallbackFn = (inMemoryDb as any)[prop];
              if (typeof fallbackFn === "function") {
                return fallbackFn.apply(inMemoryDb, args);
              }
            }
            throw err;
          }
        };
      }

      if (typeof val === "object" && val !== null) {
        return new Proxy(val, {
          get(subTarget, subProp, subReceiver) {
            if (dbIsOffline) {
              const table = (inMemoryDb as any)[prop];
              if (table) {
                const fn = table[subProp];
                if (typeof fn === "function") {
                  return (...subArgs: any[]) => fn.apply(table, [...subArgs, inMemoryDb]);
                }
                return fn;
              }
            }

            const subVal = Reflect.get(subTarget, subProp, subReceiver);
            if (typeof subVal === "function") {
              return async function (...args: any[]) {
                try {
                  return await subVal.apply(subTarget, args);
                } catch (err: any) {
                  if (isConnectionError(err)) {
                    dbIsOffline = true;
                    const table = (inMemoryDb as any)[prop];
                    if (table && typeof table[subProp] === "function") {
                      return table[subProp].apply(table, [...args, inMemoryDb]);
                    }
                  }
                  throw err;
                }
              };
            }
            return subVal;
          },
        });
      }

      return val;
    },
  });
}

export const db: PrismaClient = globalDb.db ?? createFallbackDb();
if (process.env.NODE_ENV !== "production") globalDb.db = db;

