import path from "node:path";
import fs from "node:fs";
import ts from "typescript";
import { expect, it } from "vitest";
import {
  operatorConfig,
  safeRequest,
} from "../../scripts/workforce/operator-policy";
import {
  projectTask,
  actorLabel,
} from "@/modules/workforce-control-plane/reader";
import { workforceImportViolations } from "../../scripts/workforce-import-boundary";
import type {
  WorkforceTask,
  WorkforceReceipt,
} from "@/generated/workforce/client";
const env = {
  NODE_ENV: "test",
  BBD_WORKFORCE_OPERATOR_LOCAL: "1",
  WORKFORCE_AUTH_URL: "http://localhost:3100",
  WORKFORCE_RUNTIME_DATABASE_URL:
    "postgresql://runtime:synthetic@localhost/bbd_workforce_operator_test",
};
it("requires opt-in, isolated loopback database/origin and no owner/customer credentials", () => {
  expect(operatorConfig(env).port).toBe(3100);
  for (const change of [
    { NODE_ENV: "production" },
    { BBD_WORKFORCE_OPERATOR_LOCAL: "0" },
    { WORKFORCE_AUTH_URL: "http://0.0.0.0:3100" },
    { WORKFORCE_AUTH_URL: "http://localhost:3000" },
    { WORKFORCE_AUTH_URL: "http://localhost:3100/untrusted" },
    {
      WORKFORCE_RUNTIME_DATABASE_URL:
        "postgresql://runtime:synthetic@remote/bbd_workforce_operator_test",
    },
    {
      WORKFORCE_RUNTIME_DATABASE_URL:
        env.WORKFORCE_RUNTIME_DATABASE_URL + "?host=remote",
    },
    {
      WORKFORCE_RUNTIME_DATABASE_URL:
        env.WORKFORCE_RUNTIME_DATABASE_URL + "?schema=private",
    },
    { WORKFORCE_TEST_DATABASE_URL: "secret" },
    { DATABASE_URL: "secret" },
  ])
    expect(() => operatorConfig({ ...env, ...change })).toThrow();
});
it("rejects hostile hosts, cross-site access and forwarded identity headers", () => {
  expect(
    safeRequest(
      { host: "localhost:3100" },
      "127.0.0.1",
      "localhost:3100",
      env.WORKFORCE_AUTH_URL,
    ),
  ).toBe(true);
  for (const headers of [
    { host: "evil.test" },
    { host: "localhost:3100", origin: "https://evil.test" },
    { host: "localhost:3100", "sec-fetch-site": "cross-site" },
    { host: "localhost:3100", "x-forwarded-for": "127.0.0.1" },
    { host: "localhost:3100", "x-bbd-client-ip": "127.0.0.1" },
    { host: "localhost:3100", "x-user-id": "founder" },
  ])
    expect(
      safeRequest(
        headers,
        "127.0.0.1",
        "localhost:3100",
        env.WORKFORCE_AUTH_URL,
      ),
    ).toBe(false);
  expect(
    safeRequest(
      { host: "localhost:3100" },
      "192.0.2.1",
      "localhost:3100",
      env.WORKFORCE_AUTH_URL,
    ),
  ).toBe(false);
});
it("redacts payloads, result bodies and identities and never infers running agents", () => {
  const now = new Date();
  const t = {
    id: "opaque",
    companyId: "company",
    department: "ENGINEERING",
    status: "RUNNING",
    submittedBy: "secret-person@example.com",
    approverId: null,
    founderId: null,
    approvalState: "APPROVED",
    approvalUntil: new Date(now.getTime() + 60000),
    expiresAt: new Date(now.getTime() + 60000),
    request: { password: "SECRET", createdAt: "PRIVATE" },
    result: { draft: "PRIVATE" },
    digest: "SECRET",
    approvalId: "binding",
    version: 3,
    attempts: 1,
  } as unknown as WorkforceTask;
  const r = {
    id: "receipt",
    executorId: "secret-executor",
    status: "CLAIMED",
    createdAt: now,
    finishedAt: null,
    attempt: 1,
    digest: "SECRET",
    approvalId: "binding",
  } as WorkforceReceipt;
  const dto = projectTask(t, [r], now);
  expect(dto.activity).toBe("Claimed — activity unconfirmed");
  expect(JSON.stringify(dto)).not.toMatch(
    /SECRET|PRIVATE|secret-person|secret-executor|password/,
  );
  expect(
    projectTask(t, [{ ...r, createdAt: new Date(now.getTime() - 120001) }], now)
      .activity,
  ).toBe("Stale claim — outcome unknown");
  expect(projectTask(t, [], now).activity).toContain("unknown");
  expect(actorLabel("company", "actor")).not.toBe(
    actorLabel("foreign", "actor"),
  );
  expect(dto.evidence).toContain("No task-specific test evidence");
});
it("closes transitive reader-to-execution edges and limits the operator entrypoint to reads", () => {
  const conf = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
  const options = ts.parseJsonConfigFileContent(
    conf.config,
    ts.sys,
    process.cwd(),
  ).options;
  for (const source of [
    'export * from "./control";',
    'import {mockAttempt} from "../workforce-contract/mock-adapter";',
  ])
    expect(
      workforceImportViolations(
        path.resolve("src/modules/workforce-control-plane/reader-helper.ts"),
        source,
        options,
      ),
    ).not.toEqual([]);
  for (const source of [
    'export * from "./claim-fixture";',
    'import {createWorkforceControlPlane} from "../../src/modules/workforce-control-plane/control";',
    "const x = import(untrusted);",
  ]) {
    expect(
      workforceImportViolations(
        path.resolve("scripts/workforce/operator-policy.ts"),
        source,
        options,
      ),
    ).not.toEqual([]);
  }
  for (const file of [
    "operator.tsx",
    "operator-view.tsx",
    "operator-policy.ts",
  ]) {
    const source = fs.readFileSync(`scripts/workforce/${file}`, "utf8");
    expect(
      workforceImportViolations(
        path.resolve(`scripts/workforce/${file}`),
        source,
        options,
      ),
    ).toEqual([]);
    expect(source).not.toMatch(
      /(?:from\s*|import\s*\(|require\s*\()["'][^"']*(?:\/control["']|mock-adapter|internal-workforce)/,
    );
  }
});
