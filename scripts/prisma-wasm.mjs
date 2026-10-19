/** Network-restricted development fallback, pinned to Prisma 7.10.1 internals.
 * Uses npm-integrity-verified official Prisma WASM artifacts; never skips checksums.
 * Standard Prisma CLI remains the default when its engine host is reachable.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { PrismaPg } from "@prisma/adapter-pg";
import { bindMigrationAwareSqlAdapterFactory } from "@prisma/driver-adapter-utils";
import * as runtime from "@prisma/schema-engine-wasm/schema_engine_bg";
const require = createRequire(import.meta.url);
const { getGenerators } = require("@prisma/internals");
const { PrismaClientTsGenerator } = require("@prisma/client-generator-ts");
if (fs.existsSync(".env")) process.loadEnvFile(".env");
const command = process.argv[2];
if (command === "generate") {
  const generators = await getGenerators({
    schemaPath: path.resolve("prisma/schema.prisma"),
    registry: {
      "prisma-client": {
        type: "in-process",
        generator: new PrismaClientTsGenerator(),
      },
    },
    skipDownload: true,
    cliCommand: "prisma",
  });
  try {
    for (const generator of generators) await generator.generate();
  } finally {
    for (const generator of generators) generator.stop();
  }
  console.log("Prisma client generated using official WASM tooling.");
} else if (command === "migrate" || command === "diff") {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const bytes = fs.readFileSync(
    path.join(
      path.dirname(
        require.resolve("@prisma/schema-engine-wasm/schema_engine_bg"),
      ),
      "schema_engine_bg.wasm",
    ),
  );
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
    "./schema_engine_bg.js": runtime,
  });
  runtime.__wbg_set_wasm(instance.exports);
  instance.exports.__wbindgen_start();
  const pg = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const connections = [];
  const factory = {
    provider: pg.provider,
    adapterName: pg.adapterName,
    connect: async () => {
      const adapter = await pg.connect();
      connections.push(adapter);
      return adapter;
    },
    connectToShadowDb: async () => {
      const adapter = await pg.connectToShadowDb();
      connections.push(adapter);
      return adapter;
    },
  };
  const schemaPath = path.resolve("prisma/schema.prisma"),
    content = fs.readFileSync(schemaPath, "utf8");
  const engine = await runtime.SchemaEngine.new(
    { datamodels: [[schemaPath, content]] },
    () => {},
    bindMigrationAwareSqlAdapterFactory(factory),
  );
  const filters = { externalTables: [], externalEnums: [] };
  try {
    if (command === "diff") {
      const result = await engine.diff({
        from: { tag: "empty" },
        to: { tag: "schemaDatamodel", files: [{ path: schemaPath, content }] },
        script: true,
        exitCode: null,
        filters,
      });
      process.stdout.write(result.stdout);
    } else {
      const baseDir = path.resolve("prisma/migrations");
      const migrationDirectories = fs
        .readdirSync(baseDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((d) => ({
          path: d.name,
          migrationFile: {
            path: "migration.sql",
            content: {
              tag: "ok",
              value: fs.readFileSync(
                path.join(baseDir, d.name, "migration.sql"),
                "utf8",
              ),
            },
          },
        }));
      const result = await engine.applyMigrations({
        migrationsList: {
          baseDir,
          lockfile: {
            path: "migration_lock.toml",
            content: fs.readFileSync(
              path.join(baseDir, "migration_lock.toml"),
              "utf8",
            ),
          },
          shadowDbInitScript: "",
          migrationDirectories,
        },
        filters,
      });
      console.log(JSON.stringify(result));
    }
  } finally {
    engine.free();
    await Promise.all(connections.map((connection) => connection.dispose()));
  }
} else
  throw new Error(
    "Use generate, migrate, or diff. This helper never resets a database.",
  );
