// Benchmark verdict diff: current results.json vs 6d5a758 baseline.
import fs from "node:fs";
import { execSync } from "node:child_process";

const now = JSON.parse(fs.readFileSync("examples/benchmark/results.json", "utf8"));
const base = JSON.parse(
  execSync("git show 6d5a758:examples/benchmark/results.json").toString(),
);
const norm = (r) => (Array.isArray(r) ? r : Object.values(r));
const nowById = {};
const baseById = {};
for (const x of norm(now)) nowById[x.id ?? x.case] = x;
for (const x of norm(base)) baseById[x.id ?? x.case] = x;

let changes = 0;
const up = [];
const down = [];
for (const id of Object.keys(nowById)) {
  const o = (nowById[id].verdict ?? "").toUpperCase();
  const b = (baseById[id]?.verdict ?? "").toUpperCase();
  if (o !== b) {
    changes++;
    if (o === "BLOCKED") up.push(id);
    else down.push(id);
  }
}
console.log("verdict changes vs baseline:", changes);
console.log("now BLOCKED (were EXECUTED):", up.join(", ") || "(none)");
console.log("now EXECUTED (were BLOCKED):", down.join(", ") || "(none)");

const ids = Object.keys(nowById);
const blocked = ids.filter((id) => (nowById[id].verdict ?? "").toUpperCase() === "BLOCKED");
console.log("total: blocked", blocked.length, "/ executed", ids.length - blocked.length, "/", ids.length);
const suiteAExec = ids.filter((id) => id.startsWith("a") && (nowById[id].verdict ?? "").toUpperCase() === "EXECUTED");
console.log("Suite A executed ids:", suiteAExec.join(", ") || "(none)");
const suiteB = ids.filter((id) => id.startsWith("b"));
const suiteBBlocked = suiteB.filter((id) => (nowById[id].verdict ?? "").toUpperCase() === "BLOCKED");
console.log("Suite B blocked:", suiteBBlocked.length, "/", suiteB.length);
