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

describe("extractFile (javascript)", () => {
  it("extracts functions, classes, imports and exports from a JS module", async () => {
    const result = await extractFile(fixture("javascript", "services.js"));

    expect(result.language).toBe("javascript");
    expect(result.hasParseErrors).toBe(false);

    expect(result.functions).toEqual([
      { name: "formatPath", exported: true, startLine: 6, endLine: 8 },
      { name: "clampValue", exported: false, startLine: 10, endLine: 14 },
      { name: "buildKey", exported: true, startLine: 16, endLine: 16 },
      { name: "noop", exported: false, startLine: 18, endLine: 18 },
    ]);

    expect(result.classes).toEqual([
      {
        name: "ServiceRegistry",
        exported: true,
        methods: [
          { name: "register", startLine: 21, endLine: 24 },
          { name: "resolve", startLine: 26, endLine: 28 },
        ],
        startLine: 20,
        endLine: 29,
      },
      {
        name: "InternalCache",
        exported: false,
        methods: [],
        startLine: 31,
        endLine: 31,
      },
    ]);

    expect(result.imports).toEqual([
      {
        specifier: "path",
        defaultImport: "path",
        namespaceImport: null,
        namedImports: [],
        line: 1,
      },
      {
        specifier: "./format",
        defaultImport: null,
        namespaceImport: null,
        namedImports: ["format", "pad"],
        line: 2,
      },
      {
        specifier: "../strings",
        defaultImport: null,
        namespaceImport: "strings",
        namedImports: [],
        line: 3,
      },
      {
        specifier: "fs",
        defaultImport: "fs",
        namespaceImport: null,
        namedImports: [],
        line: 4,
      },
    ]);

    expect(result.exports).toEqual([
      { kind: "named", names: ["formatPath"], line: 6 },
      { kind: "named", names: ["buildKey"], line: 16 },
      { kind: "default", names: ["ServiceRegistry"], line: 20 },
      { kind: "named", names: ["PublicCache"], line: 33 },
    ]);
  }, 30000);
});
