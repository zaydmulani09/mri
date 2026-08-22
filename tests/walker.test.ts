import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { walkSourceFiles } from "../src/extraction/walker.js";

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

describe("walkSourceFiles", () => {
  it("returns supported source files while skipping ignored dirs and gitignored paths", async () => {
    const repoRoot = path.join(fixturesDir, "sample_repo");
    const files = await walkSourceFiles(repoRoot);
    expect(files).toEqual([
      "app.py",
      "docs/note.py",
      "index.js",
      "utils/helpers.js",
    ]);
  }, 30000);

  it("honors nested .gitignore files", async () => {
    const repoRoot = path.join(fixturesDir, "sample_repo");
    const files = await walkSourceFiles(repoRoot);
    expect(files).not.toContain("docs/drafts.js");
  }, 30000);

  it("throws for a nonexistent root", async () => {
    const missing = path.join(fixturesDir, "no-such-repo");
    await expect(walkSourceFiles(missing)).rejects.toThrow(/does not exist/);
  });
});
