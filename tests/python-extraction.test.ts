import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFile } from "../src/extraction/index.js";

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

function fixture(...segments: string[]): string {
  return path.join(fixturesDir, ...segments);
}

describe("extractFile (python)", () => {
  it("extracts functions, classes with decorated methods and imports", async () => {
    const result = await extractFile(fixture("python", "workers.py"));

    expect(result.language).toBe("python");
    expect(result.hasParseErrors).toBe(false);

    expect(result.functions).toEqual([
      { name: "setup_environ", exported: true, startLine: 26, endLine: 27 },
      { name: "drain", exported: true, startLine: 30, endLine: 31 },
      { name: "_private_helper", exported: true, startLine: 34, endLine: 35 },
    ]);

    expect(result.classes).toEqual([
      {
        name: "Worker",
        exported: true,
        methods: [
          { name: "run", startLine: 10, endLine: 11 },
          { name: "describe", startLine: 14, endLine: 15 },
        ],
        extends: [],
        startLine: 7,
        endLine: 15,
      },
      {
        name: "WorkerPool",
        exported: true,
        methods: [
          { name: "__init__", startLine: 19, endLine: 20 },
          { name: "spawn", startLine: 22, endLine: 23 },
        ],
        extends: [],
        startLine: 18,
        endLine: 23,
      },
    ]);

    expect(result.calls).toEqual([]);

    expect(result.imports).toEqual([
      {
        specifier: "os",
        defaultImport: null,
        namespaceImport: "os",
        namedImports: [],
        line: 1,
      },
      {
        specifier: "dataclasses",
        defaultImport: null,
        namespaceImport: null,
        namedImports: ["dataclass", "fld"],
        line: 2,
      },
      {
        specifier: ".internals",
        defaultImport: null,
        namespaceImport: null,
        namedImports: ["helper"],
        line: 3,
      },
    ]);

    expect(result.exports).toEqual([]);
  }, 30000);
});
