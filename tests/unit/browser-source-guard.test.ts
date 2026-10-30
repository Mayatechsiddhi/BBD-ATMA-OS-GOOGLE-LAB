import {
  mkdtempSync,
  writeFileSync,
  utimesSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
import { execFileSync } from "node:child_process";
import { browserSourceGuard } from "../../scripts/browser-diagnostics";
let directory: string, file: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "bbd-browser-guard-"));
  file = join(directory, "fixture.ts");
  writeFileSync(file, "synthetic source");
  vi.mocked(execFileSync).mockReturnValue(file + "\0");
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  vi.clearAllMocks();
});
it("allows an unchanged checkout without altering browser assertions", () => {
  const verify = browserSourceGuard();
  expect(verify).not.toThrow();
});
it("invalidates even same-content edits that can trigger development hot reload", () => {
  const verify = browserSourceGuard();
  const before = statSync(file);
  utimesSync(file, before.atime, new Date(before.mtimeMs + 1000));
  expect(verify).toThrow("Browser checkout changed during execution");
});
it("invalidates newly added source files during a browser run", () => {
  const verify = browserSourceGuard();
  const added = join(directory, "added.ts");
  writeFileSync(added, "synthetic additional source");
  vi.mocked(execFileSync).mockReturnValue(file + "\0" + added + "\0");
  expect(verify).toThrow("Browser checkout changed during execution");
});
