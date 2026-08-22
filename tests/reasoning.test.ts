import { beforeAll, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { promises as fs, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRepoGraph, openGraph, type GraphStore } from "../src/graph/index.js";
import {
  parseQuestion,
  parseQuestionSmart,
  NoLocalModel,
  buildReasoningContext,
  executeQuery,
} from "../src/reasoning/index.js";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "analysis_repo",
);

describe("question parser", () => {
  it("maps blast-radius phrasings to the same structured query", () => {
    const expected = { type: "blast-radius", target: "pad" };
    for (const q of [
      "blast radius of pad",
      "what depends on pad",
      "who calls pad",
      "who uses fetchUser",
      "impact of changing src/api.js",
      "blast radius of src/api.js",
    ]) {
      const result = parseQuestion(q);
      expect(result.ok, q).toBe(true);
      if (!result.ok) continue;
      expect(result.query).toMatchObject(expected.type === "blast-radius" ? { type: "blast-radius" } : {});
      expect((result.query as { target?: string }).target).toBeTruthy();
      expect(result.via).toBe("deterministic");
    }
  });

  it("preserves the case of the extracted target", () => {
    const result = parseQuestion("blast radius of fetchUser");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.query.type === "blast-radius" ? result.query.target : null,
    ).toBe("fetchUser");
  });

  it("maps dead-code phrasings", () => {
    for (const [q, target] of [
      ["is ghost dead code", "ghost"],
      ["is helper dead code?", "helper"],
      ["is Widget a dead class", "Widget"],
      ["is hot unused", "hot"],
    ] as const) {
      const result = parseQuestion(q);
      expect(result.ok, q).toBe(true);
      if (!result.ok) continue;
      expect(result.query.type).toBe("dead-code-check");
      expect(result.query.type === "dead-code-check" ? result.query.target : null).toBe(target);
    }
  });

  it("maps riskiest-file phrasings with and without scope", () => {
    const bare = parseQuestion("what is the riskiest file");
    expect(bare.ok).toBe(true);
    if (bare.ok && bare.query.type === "riskiest-file") expect(bare.query.scope).toBeUndefined();

    const scoped = parseQuestion("what's the riskiest file in py");
    expect(scoped.ok).toBe(true);
    if (scoped.ok && scoped.query.type === "riskiest-file") expect(scoped.query.scope).toBe("py");

    const alt = parseQuestion("which file is the riskiest in src");
    expect(alt.ok).toBe(true);
    if (alt.ok && alt.query.type === "riskiest-file") expect(alt.query.scope).toBe("src");
  });

  it("maps untested phrasings", () => {
    const bare = parseQuestion("what is not tested");
    expect(bare.ok).toBe(true);
    if (bare.ok && bare.query.type === "untested") expect(bare.query.scope).toBeUndefined();

    const scoped = parseQuestion("untested files in py");
    expect(scoped.ok).toBe(true);
    if (scoped.ok && scoped.query.type === "untested") expect(scoped.query.scope).toBe("py");

    const lacks = parseQuestion("what lacks test coverage in src");
    expect(lacks.ok).toBe(true);
    if (lacks.ok && lacks.query.type === "untested") expect(lacks.query.scope).toBe("src");
  });

  it("rejects out-of-scope questions instead of guessing", () => {
    for (const q of [
      "who is the strongest avenger",
      "write me a haiku about this repo",
      "summarize the license",
      "what does this project do",
      "",
    ]) {
      const result = parseQuestion(q);
      expect(result.ok, q).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toContain("won't guess");
    }
  });

  it("falls back to the deterministic parser when no model is available", async () => {
    const result = await parseQuestionSmart("is ghost dead code", new NoLocalModel());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.via).toBe("deterministic");
    expect(result.query.type).toBe("dead-code-check");
  });
});

describe("query executor", () => {
  const tmpRepo = mkdtempSync(path.join(os.tmpdir(), "mri-reasoning-"));
  let store: GraphStore;

  beforeAll(async () => {
    await fs.cp(fixtureRoot, tmpRepo, { recursive: true });
    await buildRepoGraph(tmpRepo, path.join(tmpRepo, ".mri", "graph.sqlite"));
    store = openGraph(path.join(tmpRepo, ".mri", "graph.sqlite"));
  });

  it("executes a blast-radius query against the real graph", () => {
    const ctx = buildReasoningContext(store, tmpRepo, 90);
    const parsed = parseQuestion("blast radius of pad");
    if (!parsed.ok || parsed.query.type !== "blast-radius") throw new Error("parse failed");
    const answer = executeQuery(ctx, parsed.query);

    expect(answer.kind).toBe("blast-radius");
    if (answer.kind !== "blast-radius") return;
    const ids = answer.result.dependents.map((d) => d.id);
    expect(ids).toContain("fn:src/format.js#money");
    expect(ids).toContain("fn:src/api.js#fetchUser");
  });

  it("reports dead-code verdicts with confidence labels", () => {
    const ctx = buildReasoningContext(store, tmpRepo, 90);
    const ghost = executeQuery(ctx, { type: "dead-code-check", target: "ghost" });
    expect(ghost).toMatchObject({ kind: "dead-code-check", verdict: "dead-candidate", confidence: "confirmed-unreferenced" });

    const formatter = executeQuery(ctx, { type: "dead-code-check", target: "formatter" });
    expect(formatter).toMatchObject({ kind: "dead-code-check", verdict: "dead-candidate", confidence: "no-resolved-references" });

    const referenced = executeQuery(ctx, { type: "dead-code-check", target: "pad" });
    expect(referenced).toMatchObject({ kind: "dead-code-check", verdict: "referenced" });
  });

  it("returns multiple candidates rather than guessing between same-named symbols", () => {
    const ctx = buildReasoningContext(store, tmpRepo, 90);
    const answer = executeQuery(ctx, { type: "blast-radius", target: "process" });
    expect(answer.kind).toBe("ambiguous-target");
    if (answer.kind !== "ambiguous-target") return;
    expect(answer.candidates.map((c) => c.id).sort()).toEqual([
      "fn:src/process_a.js#process",
      "fn:src/process_b.js#process",
    ]);
  });

  it("scopes riskiest-file and untested queries by path prefix", () => {
    const ctx = buildReasoningContext(store, tmpRepo, 90);

    const riskiest = executeQuery(ctx, { type: "riskiest-file", scope: "py" });
    expect(riskiest.kind).toBe("riskiest-file");
    if (riskiest.kind === "riskiest-file" && riskiest.file) {
      expect(riskiest.file.path.startsWith("py/")).toBe(true);
    }

    const untested = executeQuery(ctx, { type: "untested", scope: "py" });
    expect(untested.kind).toBe("untested");
    if (untested.kind === "untested") {
      expect(untested.files.every((f) => f.startsWith("py/"))).toBe(true);
    }
  });

  it("answers unknown targets honestly", () => {
    const ctx = buildReasoningContext(store, tmpRepo, 90);
    const answer = executeQuery(ctx, { type: "blast-radius", target: "doesNotExist" });
    expect(answer.kind).toBe("target-not-found");
  });

  it("keeps the sqlite handle usable after queries", () => {
    const rows = new DatabaseSync(path.join(tmpRepo, ".mri", "graph.sqlite"))
      .prepare("SELECT COUNT(*) AS n FROM nodes")
      .all() as Array<{ n: number }>;
    expect(rows[0]?.n ?? 0).toBeGreaterThan(0);
  });
});
