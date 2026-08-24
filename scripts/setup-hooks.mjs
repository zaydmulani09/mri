// Repo setup: pin the commit identity and point git at the committed hooks.
// Runs automatically via the package.json "prepare" lifecycle (i.e. on every
// npm install) and can be run manually with `npm run setup-hooks`.
// Idempotent; no-ops outside a git repository (e.g. when installed as a
// dependency from a packed tarball).

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const gitDir = path.join(process.cwd(), ".git");
if (!existsSync(gitDir)) {
  console.log("setup-hooks: not a git working tree, skipping");
  process.exit(0);
}

function git(...args) {
  return execFileSync("git", args, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

git("config", "core.hooksPath", ".githooks");
git("config", "user.name", "Zayd Mulani");
git("config", "user.email", "zaydmulani@gmail.com");

console.log(
  'setup-hooks: core.hooksPath=".githooks"; identity pinned to Zayd Mulani <zaydmulani@gmail.com>',
);
