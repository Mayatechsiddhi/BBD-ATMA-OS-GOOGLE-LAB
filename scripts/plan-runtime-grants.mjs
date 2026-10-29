/** Print only. Operator must review drift, migrations and rollout BEFORE use. */
import { runtimeGrantStatements } from "../src/lib/runtime-privileges.ts";
const role = process.argv[2];
if (!role) throw new Error("Supply the explicitly reviewed runtime role name");
console.log(
  "-- REVIEW ONLY: no SQL is executed. Rehearse cutover/rollback first.",
);
console.log(
  "-- Reject existing privilege drift; this additive plan never repairs excess grants.",
);
console.log("BEGIN;\n" + runtimeGrantStatements(role).join("\n") + "\nCOMMIT;");
