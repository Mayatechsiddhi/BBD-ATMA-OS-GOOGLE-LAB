import { workforceGrants } from "../../src/modules/workforce-control-plane/privileges";
// Prints review-only SQL. Does not connect to a database or execute it.
const role = process.argv[2];
if (!role) throw Error("Supply the reviewed runtime role name");
console.log(workforceGrants(role));
