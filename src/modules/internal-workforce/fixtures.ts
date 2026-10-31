import { createHash } from "node:crypto";

// Closed synthetic catalog: no file reads, repository queries or customer data.
export const fixtureCommit = "c453ed0b452ab3c9b6e5575fadc2e04d402fa0a2";
export const fixtureRepository = "bloomdigital369-hue/BBD-MASTER-ATMA-OS";
export const drafts = Object.freeze({
  ENGINEERING:
    "# Synthetic Engineering draft\n\nMock review only. Review the synthetic diff and verify regression coverage. No repository was read or changed. Human review required.",
  OPERATIONS:
    "# Synthetic Operations draft\n\nMock readiness checklist only. Verify the synthetic build evidence and review the rollback plan. No infrastructure was inspected or changed. Human review required.",
});
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function fixtureArtifact(department: keyof typeof drafts) {
  return `sha256:${digest(JSON.stringify({ classification: "synthetic-internal", department, repository: fixtureRepository, commit: fixtureCommit, fixtureVersion: 1 }))}`;
}
