import fs from "node:fs";
const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
const packages = Object.entries(lock.packages)
  .filter(([name]) => name)
  .map(([name, p]) => ({
    path: name,
    version: p.version,
    license: p.license ?? "UNKNOWN",
    development: !!p.dev,
    optional: !!p.optional,
  }));
const unknown = packages.filter((p) => p.license === "UNKNOWN");
if (unknown.length)
  throw new Error("Review missing license declarations before proceeding");
fs.mkdirSync("docs", { recursive: true });
fs.writeFileSync(
  "docs/dependency-licenses.json",
  JSON.stringify({ lockfileVersion: lock.lockfileVersion, packages }, null, 2) +
    "\n",
);
console.log(
  `Inventoried ${packages.length} locked packages; no missing license declarations. SPDX inventory does not replace legal review or bundled notices.`,
);
