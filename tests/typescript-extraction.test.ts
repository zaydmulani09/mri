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

describe("extractFile (typescript)", () => {
  it("parses TS 5.0 export-type-star syntax without parse errors", async () => {
    const result = await extractFile(fixture("typescript", "type-exports.ts"));

    expect(result.hasParseErrors).toBe(false);
    expect(result.exports).toEqual([
      { kind: "all", names: [], line: 3 },
      { kind: "all", names: ["ns"], line: 4 },
      { kind: "named", names: ["sendRequest"], line: 6 },
      { kind: "named", names: ["Requester"], line: 10 },
    ]);
    expect(result.functions.map((f) => f.name)).toContain("sendRequest");
    expect(result.classes.map((c) => c.name)).toContain("Requester");
  }, 30000);

  it("extracts functions, classes and methods from a TS module", async () => {
    const result = await extractFile(fixture("typescript", "models.ts"));

    expect(result.language).toBe("typescript");
    expect(result.hasParseErrors).toBe(false);

    expect(result.functions).toEqual([
      { name: "createUser", exported: true, startLine: 33, endLine: 33 },
    ]);

    expect(result.classes).toEqual([
      {
        name: "UserService",
        exported: true,
        methods: [
          { name: "find", startLine: 16, endLine: 18 },
          { name: "save", startLine: 20, endLine: 22 },
        ],
        extends: [],
        startLine: 11,
        endLine: 23,
      },
      {
        name: "Repository",
        exported: true,
        methods: [
          { name: "fetch", startLine: 26, endLine: 26 },
          { name: "wrap", startLine: 28, endLine: 30 },
        ],
        extends: [],
        startLine: 25,
        endLine: 31,
      },
    ]);

    expect(result.calls).toEqual([
      {
        kind: "member",
        object: "this.cache",
        name: "get",
        line: 17,
        container: "UserService.find",
      },
      {
        kind: "member",
        object: "this.cache",
        name: "set",
        line: 21,
        container: "UserService.save",
      },
    ]);

    expect(result.imports).toEqual([
      {
        specifier: "./config",
        defaultImport: null,
        namespaceImport: null,
        namedImports: ["Config"],
        line: 1,
      },
      {
        specifier: "express",
        defaultImport: "express",
        namespaceImport: null,
        namedImports: ["Router"],
        line: 2,
      },
    ]);

    expect(result.exports).toEqual([
      { kind: "named", names: ["User"], line: 4 },
      { kind: "named", names: ["Result"], line: 9 },
      { kind: "named", names: ["UserService"], line: 11 },
      { kind: "named", names: ["Repository"], line: 25 },
      { kind: "named", names: ["createUser"], line: 33 },
    ]);
  }, 30000);
});
