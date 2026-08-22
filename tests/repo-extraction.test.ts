import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractRepo } from "../src/extraction/index.js";

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

describe("extractRepo", () => {
  it("walks the fixture repo and aggregates per-file symbols", async () => {
    const repoRoot = path.join(fixturesDir, "sample_repo");
    const result = await extractRepo(repoRoot);

    expect(result.files.map((file) => file.path)).toEqual([
      "app.py",
      "docs/note.py",
      "index.js",
      "utils/helpers.js",
    ]);

    const functions = result.files.flatMap((file) => file.functions);
    const classes = result.files.flatMap((file) => file.classes);
    const imports = result.files.flatMap((file) => file.imports);
    const exports = result.files.flatMap((file) => file.exports);

    expect(functions.map((fn) => fn.name).sort()).toEqual([
      "boot",
      "main",
      "note",
      "run",
    ]);
    expect(classes.map((cls) => cls.name)).toEqual(["App"]);
    expect(imports.map((imp) => imp.specifier).sort()).toEqual([
      "./utils/helpers",
      "os",
    ]);
    expect(exports).toHaveLength(4);
    expect(result.root.endsWith("sample_repo")).toBe(true);
    expect(result.generatedAt).toBeTruthy();
  }, 60000);
});
