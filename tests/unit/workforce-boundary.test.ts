import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { workforceImportViolations } from "../../scripts/workforce-import-boundary";
const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(
  config.config,
  ts.sys,
  process.cwd(),
).options;
const file = path.resolve("src/modules/guard-fixture.ts");
describe("workforce mock application boundary", () => {
  it.each([
    'import { x } from "@/modules/internal-workforce/harness";',
    'export * from "./internal-workforce/fixtures";',
    'const x = import("./internal-workforce/mock-adapter");',
    'const x = require("./internal-workforce/contract");',
    'import x = require("./internal-workforce/harness");',
    'type X = import("./internal-workforce/contract").TaskRequest;',
    "const x = import(untrusted);",
    'export * from "./workforce-control-plane/control";',
    'import { mockAttempt } from "./workforce-contract/mock-adapter";',
  ])("rejects forbidden source edge: %s", (source) => {
    expect(workforceImportViolations(file, source, options)).not.toEqual([]);
  });
  it("checks every application source, including indirect barrel edges", () => {
    const files = ts.sys.readDirectory(
      path.resolve("src"),
      [".ts", ".tsx"],
      ["**/generated/**"],
    );
    for (const name of files)
      expect(
        workforceImportViolations(name, ts.sys.readFile(name)!, options),
        name,
      ).toEqual([]);
  });
  it.each(["@/lib/db", "@/lib/auth", "@/lib/session", "@/modules/crm/service"])(
    "denies controller dependency on customer module %s",
    (target) => {
      expect(
        workforceImportViolations(
          path.resolve("src/modules/workforce-control-plane/fixture.ts"),
          `import {x} from "${target}";`,
          options,
        ),
      ).not.toEqual([]);
    },
  );
});
