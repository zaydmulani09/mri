import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { extractRepo, extractFile } from "../src/extraction/index.js";

describe("extraction failure containment", () => {
  it("keeps extracting the rest of a repo when one file cannot be read", async () => {
    const tmpRepo = mkdtempSync(path.join(os.tmpdir(), "mri-contain-"));
    await fs.writeFile(
      path.join(tmpRepo, "good.js"),
      "export function good() {\n  return 1;\n}\n",
      "utf8",
    );

    const lockedPath = path.join(tmpRepo, "locked.ts");
    await fs.writeFile(lockedPath, "export function locked() {}", "utf8");

    const originalReadFile = fs.readFile;
    const readFileSpy = async (target: unknown, ...rest: unknown[]) => {
      if (typeof target === "string" && target === lockedPath) {
        throw new Error("EACCES: simulated permission failure");
      }
      return (originalReadFile as (...a: unknown[]) => Promise<string>)(target, ...rest);
    };
    Object.assign(fs, { readFile: readFileSpy });

    try {
      const result = await extractRepo(tmpRepo);
      expect(result.files).toHaveLength(2);
      expect(result.files.find((f) => f.path === "good.js")?.functions.map((f) => f.name)).toEqual([
        "good",
      ]);
      const broken = result.files.find((f) => f.path === "locked.ts");
      expect(broken?.hasParseErrors).toBe(true);
      expect(broken?.functions).toHaveLength(0);
    } finally {
      Object.assign(fs, { readFile: originalReadFile });
    }
  });

  it("still reports hasParseErrors for genuinely unparseable files without throwing", async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "mri-broken-"));
    const broken = path.join(tmpDir, "broken.ts");
    await fs.writeFile(broken, "export function {{{{ ;;;\nthis is not typescript ]]", "utf8");
    const result = await extractFile(broken);
    expect(result.hasParseErrors).toBe(true);
  });
});
