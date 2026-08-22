import { beforeAll, describe, expect, it } from "vitest";
import { promises as fs, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runGuardCommand } from "../src/cli/guard-command.js";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "analysis_repo",
);

const SCOPE = "fn:src/api.js#fetchUser";

describe("mri guard command", () => {
  const tmpRepo = mkdtempSync(path.join(os.tmpdir(), "mri-guard-cli-"));

  let passFile: string;
  let blockedFile: string;
  let grantConfig: string;

  beforeAll(async () => {
    await fs.cp(fixtureRoot, tmpRepo, { recursive: true });
    passFile = path.join(tmpRepo, "snippet-pass.js");
    blockedFile = path.join(tmpRepo, "snippet-blocked.js");
    grantConfig = path.join(tmpRepo, "resources.json");
    await fs.writeFile(passFile, "helper(21)", "utf8");
    await fs.writeFile(blockedFile, "process.env.TOKEN", "utf8");
    await fs.writeFile(
      grantConfig,
      JSON.stringify({
        scopes: {
          [SCOPE]: {
            environment: [{ name: "TOKEN", access: "read" }],
          },
        },
      }),
      "utf8",
    );
  });

  it("executes clean code and reports the return value", async () => {
    const result = await runGuardCommand({
      scopeId: SCOPE,
      source: passFile,
      repoPath: tmpRepo,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("EXECUTED cleanly");
    expect(result.stdout).toContain("granted-symbol-stub");
    expect(result.stdout).toContain("21");
  }, 60000);

  it("blocks code whose resource access has no grant and exits non-zero", async () => {
    const result = await runGuardCommand({
      scopeId: SCOPE,
      source: blockedFile,
      repoPath: tmpRepo,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("BLOCKED");
    expect(result.stdout).toMatch(/ungranted-resource|unknown-reference/);
    expect(result.stdout).toContain("TOKEN");
    expect(result.stdout).toContain("nothing was executed");
  }, 60000);

  it("flips the same code from blocked to executed once the grant exists", async () => {
    const withoutGrant = await runGuardCommand({
      scopeId: SCOPE,
      source: blockedFile,
      repoPath: tmpRepo,
    });
    expect(withoutGrant.exitCode).toBe(1);

    const withGrant = await runGuardCommand({
      scopeId: SCOPE,
      source: blockedFile,
      repoPath: tmpRepo,
      resourcesPath: grantConfig,
    });
    expect(withGrant.exitCode).toBe(0);
    expect(withGrant.stdout).toContain("EXECUTED cleanly");
  }, 120000);

  it("emits machine-readable json on request", async () => {
    const result = await runGuardCommand({
      scopeId: SCOPE,
      source: blockedFile,
      repoPath: tmpRepo,
      json: true,
    });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.outcome).toBe("blocked");
    expect(parsed.policy).toBe("fail-closed");
    expect(Array.isArray(parsed.breaches)).toBe(true);
    expect(parsed.breaches.length).toBeGreaterThan(0);
    expect(parsed.breaches[0].line).toBeGreaterThan(0);
  }, 60000);

  it("fails with a clear error for an unknown scope id", async () => {
    const result = await runGuardCommand({
      scopeId: "fn:nope/nope#missing",
      source: passFile,
      repoPath: tmpRepo,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unknown scope node id");
  }, 60000);
});
