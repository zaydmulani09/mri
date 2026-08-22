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

describe("pass-by-reference extraction", () => {
  it("records value references without inventing call edges", async () => {
    const result = await extractFile(fixture("javascript", "pass-by-reference.js"));

    expect(result.hasParseErrors).toBe(false);

    const destroyRefs = result.references.filter(
      (r) => r.name === "destroyLateRequestResult",
    );
    expect(destroyRefs).toHaveLength(3);

    const callsToDestroy = result.calls.filter((c) => c.name === "destroyLateRequestResult");
    expect(callsToDestroy).toHaveLength(1);
    expect(callsToDestroy[0]).toMatchObject({ kind: "plain", container: "directCall" });
  }, 30000);

  it("does not treat member properties or parameters as references", async () => {
    const result = await extractFile(fixture("javascript", "pass-by-reference.js"));

    expect(result.references.some((r) => r.name === "response")).toBe(false);
    expect(result.references.some((r) => r.name === "registry")).toBe(false);
    expect(result.references.some((r) => r.name === "close")).toBe(false);
  }, 30000);
});
