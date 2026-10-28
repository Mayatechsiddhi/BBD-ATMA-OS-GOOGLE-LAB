import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { assertRuntimeDatabase } from "../../src/lib/tenant-context";
import { enforceRuntimePrivileges } from "../../scripts/runtime-privileges";
import {
  identifier,
  runtimePrivilegeAuditSQL,
} from "../../src/lib/runtime-privileges";

// Every mutable role/database below is generated exclusively for this suite.
// Existing application roles, data and grants are never changed.
const source = process.env.PRIVILEGE_FIXTURE_ADMIN_URL!;
if (!source || !["localhost", "127.0.0.1"].includes(new URL(source).hostname))
  throw new Error("Isolated privilege fixtures require localhost");
const suffix = randomBytes(8).toString("hex");
const database = `bbd_privileges_${suffix}_test`;
const role = `bbd_fixture_${suffix}`;
const memberRole = `bbd_fixture_member_${suffix}`;
const password = randomBytes(32).toString("hex");
const adminURL = new URL(source);
adminURL.pathname = "/postgres";
const fixtureURL = new URL(source);
fixtureURL.pathname = "/" + database;
const roleURL = new URL(fixtureURL);
roleURL.username = role;
roleURL.password = password;
const root = new pg.Client({ connectionString: adminURL.toString() });
const owner = new pg.Client({ connectionString: fixtureURL.toString() });
const runtime = new PrismaClient({
  adapter: new PrismaPg({ connectionString: roleURL.toString() }),
});
let ownerName: string;
const audit = async () =>
  (await owner.query(runtimePrivilegeAuditSQL("$1"), [role])).rows;
const grants = async () =>
  (
    await owner.query(
      `SELECT c.oid::text,c.relacl::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.oid`,
    )
  ).rows;
let createdDatabase = false,
  createdRole = false,
  createdMember = false,
  connectedOwner = false;
beforeAll(async () => {
  await root.connect();
  ownerName = (await root.query("SELECT current_user")).rows[0].current_user;
  await root.query(
    `CREATE ROLE ${identifier(role)} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${pg.escapeLiteral(password)}`,
  );
  createdRole = true;
  await root.query(`CREATE ROLE ${identifier(memberRole)} NOLOGIN`);
  createdMember = true;
  await root.query(`CREATE DATABASE ${identifier(database)}`);
  createdDatabase = true;
  await owner.connect();
  connectedOwner = true;
  // CI provisions the login before the first migration. Verify that bootstrap
  // also remains repeatable when the private schema/tables do not exist yet.
  expect(await enforceRuntimePrivileges(owner, role)).toBe(false);
  expect(await enforceRuntimePrivileges(owner, role)).toBe(false);
  for (const migration of readdirSync("prisma/migrations")
    .filter((name) => /^\d/.test(name))
    .sort())
    await owner.query(
      readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8"),
    );
  await enforceRuntimePrivileges(owner, role);
});
afterAll(async () => {
  await runtime.$disconnect();
  if (connectedOwner) await owner.end();
  // Delete only the uniquely named database created by this invocation. No reset
  // or DROP OWNED against an existing database/role, no CASCADE, no force flag.
  if (createdDatabase)
    await root.query(`DROP DATABASE ${identifier(database)}`);
  if (createdRole) await root.query(`DROP ROLE ${identifier(role)}`);
  if (createdMember) await root.query(`DROP ROLE ${identifier(memberRole)}`);
  await root.end();
});
describe("runtime privilege contract on isolated PostgreSQL fixtures", () => {
  it("is repeatable, retains column-only updates, and makes TRUNCATE actually fail", async () => {
    const first = await grants();
    await enforceRuntimePrivileges(owner, role);
    expect(await grants()).toEqual(first);
    expect(await audit()).toEqual([]);
    await expect(assertRuntimeDatabase(runtime)).resolves.toBeUndefined();
    const direct = new pg.Client({ connectionString: roleURL.toString() });
    await direct.connect();
    try {
      await expect(
        direct.query('TRUNCATE public."Contact"'),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await direct.end();
    }
  });

  const relationCases = [
    [
      "TRUNCATE",
      'GRANT TRUNCATE ON public."Contact"',
      'REVOKE TRUNCATE ON public."Contact"',
    ],
    [
      "REFERENCES",
      'GRANT REFERENCES ON public."Contact"',
      'REVOKE REFERENCES ON public."Contact"',
    ],
    [
      "TRIGGER",
      'GRANT TRIGGER ON public."Contact"',
      'REVOKE TRIGGER ON public."Contact"',
    ],
    [
      "MAINTAIN",
      'GRANT MAINTAIN ON public."Contact"',
      'REVOKE MAINTAIN ON public."Contact"',
    ],
    [
      "table UPDATE",
      'GRANT UPDATE ON public."Appointment"',
      'REVOKE UPDATE ON public."Appointment"',
    ],
    [
      "ownership-column UPDATE",
      'GRANT UPDATE ("organizationId") ON public."Appointment"',
      'REVOKE UPDATE ("organizationId") ON public."Appointment"',
    ],
    [
      "grant option",
      'GRANT SELECT ON public."Contact"',
      'REVOKE GRANT OPTION FOR SELECT ON public."Contact"',
    ],
    [
      "migration history",
      'GRANT SELECT ON public."_prisma_migrations"',
      'REVOKE SELECT ON public."_prisma_migrations"',
    ],
  ];
  // Migrations here use their unchanged SQL directly; add only the history shape
  // to test denial, without pretending this fixture used the migration engine.
  it.each(relationCases)(
    "rejects %s without silently revoking it",
    async (label, grant, revoke) => {
      if (label === "migration history")
        await owner.query('CREATE TABLE public."_prisma_migrations" (id text)');
      try {
        await owner.query(
          `${grant} TO ${identifier(role)}${label === "grant option" ? " WITH GRANT OPTION" : ""}`,
        );
        const before = await grants();
        expect((await audit()).length).toBeGreaterThan(0);
        await expect(enforceRuntimePrivileges(owner, role)).rejects.toThrow(
          "privilege drift",
        );
        expect(await grants()).toEqual(before);
        await expect(assertRuntimeDatabase(runtime)).rejects.toThrow(
          "Unsafe runtime",
        );
      } finally {
        await owner.query(`${revoke} FROM ${identifier(role)}`);
        if (label === "migration history")
          await owner.query('DROP TABLE public."_prisma_migrations"');
        await enforceRuntimePrivileges(owner, role);
      }
    },
  );

  it.each([
    "BYPASSRLS",
    "SUPERUSER",
    "CREATEDB",
    "CREATEROLE",
    "REPLICATION",
    "INHERIT",
  ])(
    "rejects %s and does not change cluster role attributes",
    async (attribute) => {
      await root.query(`ALTER ROLE ${identifier(role)} ${attribute}`);
      try {
        expect((await audit()).some((r) => r.kind === "role")).toBe(true);
        await expect(enforceRuntimePrivileges(owner, role)).rejects.toThrow(
          "privilege drift",
        );
        await expect(assertRuntimeDatabase(runtime)).rejects.toThrow(
          "Unsafe runtime",
        );
      } finally {
        await root.query(`ALTER ROLE ${identifier(role)} NO${attribute}`);
      }
    },
  );
  it("rejects SET ROLE membership even when NOINHERIT", async () => {
    await root.query(`GRANT ${identifier(memberRole)} TO ${identifier(role)}`);
    try {
      await expect(enforceRuntimePrivileges(owner, role)).rejects.toThrow(
        "privilege drift",
      );
      await expect(assertRuntimeDatabase(runtime)).rejects.toThrow(
        "Unsafe runtime",
      );
    } finally {
      await root.query(
        `REVOKE ${identifier(memberRole)} FROM ${identifier(role)}`,
      );
    }
  });
  it("rejects table ownership without attempting to transfer it", async () => {
    await owner.query(
      `ALTER TABLE public."Contact" OWNER TO ${identifier(role)}`,
    );
    try {
      expect((await audit()).some((r) => r.kind === "ownership")).toBe(true);
      await expect(enforceRuntimePrivileges(owner, role)).rejects.toThrow(
        "privilege drift",
      );
      await expect(assertRuntimeDatabase(runtime)).rejects.toThrow(
        "Unsafe runtime",
      );
    } finally {
      await owner.query(
        `ALTER TABLE public."Contact" OWNER TO ${identifier(ownerName)}`,
      );
      await enforceRuntimePrivileges(owner, role);
    }
  });
  it("rejects schema, function and type ownership", async () => {
    await owner.query(
      `CREATE SCHEMA fixture_owned AUTHORIZATION ${identifier(role)}`,
    );
    try {
      await expect(enforceRuntimePrivileges(owner, role)).rejects.toThrow(
        "privilege drift",
      );
    } finally {
      await owner.query("DROP SCHEMA fixture_owned");
    }
    await owner.query("CREATE TYPE public.fixture_type AS ENUM ('fixture')");
    await owner.query(
      `ALTER TYPE public.fixture_type OWNER TO ${identifier(role)}`,
    );
    try {
      await expect(enforceRuntimePrivileges(owner, role)).rejects.toThrow(
        "privilege drift",
      );
    } finally {
      await owner.query("DROP TYPE public.fixture_type");
    }
    await owner.query(
      `ALTER FUNCTION bbd_private.actor_id() OWNER TO ${identifier(role)}`,
    );
    try {
      await expect(enforceRuntimePrivileges(owner, role)).rejects.toThrow(
        "privilege drift",
      );
    } finally {
      await owner.query(
        `ALTER FUNCTION bbd_private.actor_id() OWNER TO ${identifier(ownerName)}`,
      );
      await enforceRuntimePrivileges(owner, role);
    }
  });
  it("rejects database ownership", async () => {
    await root.query(
      `ALTER DATABASE ${identifier(database)} OWNER TO ${identifier(role)}`,
    );
    try {
      await expect(enforceRuntimePrivileges(owner, role)).rejects.toThrow(
        "privilege drift",
      );
      await expect(assertRuntimeDatabase(runtime)).rejects.toThrow(
        "Unsafe runtime",
      );
    } finally {
      await root.query(
        `ALTER DATABASE ${identifier(database)} OWNER TO ${identifier(ownerName)}`,
      );
    }
  });
  it("rejects PUBLIC drift and performs no partial grants", async () => {
    await owner.query(
      `REVOKE SELECT ON public."Contact" FROM ${identifier(role)}`,
    );
    await owner.query('GRANT TRUNCATE ON public."Contact" TO PUBLIC');
    try {
      const before = await grants();
      await expect(enforceRuntimePrivileges(owner, role)).rejects.toThrow(
        "privilege drift",
      );
      expect(await grants()).toEqual(before);
      await expect(assertRuntimeDatabase(runtime)).rejects.toThrow(
        "Unsafe runtime",
      );
    } finally {
      await owner.query('REVOKE TRUNCATE ON public."Contact" FROM PUBLIC');
      await enforceRuntimePrivileges(owner, role);
    }
  });
  it("rejects schema CREATE and grants on future objects", async () => {
    await owner.query(`GRANT CREATE ON SCHEMA public TO ${identifier(role)}`);
    try {
      await expect(enforceRuntimePrivileges(owner, role)).rejects.toThrow(
        "privilege drift",
      );
    } finally {
      await owner.query(
        `REVOKE CREATE ON SCHEMA public FROM ${identifier(role)}`,
      );
    }
    await owner.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${identifier(role)}`,
    );
    try {
      await expect(enforceRuntimePrivileges(owner, role)).rejects.toThrow(
        "privilege drift",
      );
    } finally {
      await owner.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM ${identifier(role)}`,
      );
    }
  });
  it("rejects unexpected function and sequence access", async () => {
    await owner.query(
      "CREATE FUNCTION public.fixture_unexpected() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$",
    );
    try {
      await expect(enforceRuntimePrivileges(owner, role)).rejects.toThrow(
        "privilege drift",
      );
    } finally {
      await owner.query("DROP FUNCTION public.fixture_unexpected()");
    }
    await owner.query("CREATE SEQUENCE public.fixture_sequence");
    await owner.query(
      `GRANT USAGE ON SEQUENCE public.fixture_sequence TO ${identifier(role)}`,
    );
    try {
      await expect(enforceRuntimePrivileges(owner, role)).rejects.toThrow(
        "privilege drift",
      );
    } finally {
      await owner.query("DROP SEQUENCE public.fixture_sequence");
    }
    expect(await audit()).toEqual([]);
  });
});
