import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { promises as fs, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRepoGraph,
  openGraph,
  type GraphStore,
} from "../src/graph/index.js";
import {
  buildReasoningContext,
  executeQuery,
  narrateAnswer,
  parseQuestion,
  renderAnswer,
  OllamaClient,
} from "../src/reasoning/index.js";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "analysis_repo",
);

interface CapturedRequest {
  path: string;
  body: string;
}

let cannedResponse = "Ghost has no incoming references at all.";
let server: Server;
let baseUrl: string;
const captured: CapturedRequest[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      captured.push({ path: req.url ?? "", body });
      res.setHeader("content-type", "application/json");
      if ((req.url ?? "").startsWith("/api/tags")) {
        res.end(JSON.stringify({ models: [{ name: "llama3.2" }] }));
        return;
      }
      res.end(JSON.stringify({ response: cannedResponse }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("ollama-backed narration", () => {

  it("narrates through ollama when it is available", async () => {
    const client = new OllamaClient({ baseUrl, model: "test-model" });
    expect(await client.isAvailable()).toBe(true);

    const answer = { kind: "target-not-found" as const, target: "nope" };
    const text = await narrateAnswer(answer, client);
    expect(text).toBe("Ghost has no incoming references at all.");
  });

  it("sends only the structured result to the model — never the raw question", async () => {
    captured.length = 0;
    const client = new OllamaClient({ baseUrl, model: "test-model" });

    // The raw question exists only in this test's scope; the pipeline hands
    // the narrator the executed answer.
    const question = "is ghost dead code SECRET_QUESTION_MARKER";
    const parsed = parseQuestion(question);
    if (!parsed.ok) throw new Error("parse failed");
    void parsed;

    const answer = {
      kind: "dead-code-check" as const,
      target: { id: "fn:src/api.js#ghost", type: "function", name: "ghost", path: "src/api.js" },
      verdict: "dead-candidate" as const,
      confidence: "confirmed-unreferenced" as const,
    };

    await narrateAnswer(answer, client);

    expect(captured.length).toBeGreaterThan(0);
    for (const request of captured) {
      expect(request.path).toBe("/api/generate");
      expect(request.body).not.toContain("SECRET_QUESTION_MARKER");
      expect(request.body).toContain("fn:src/api.js#ghost");
      expect(request.body).toContain("confirmed-unreferenced");
    }
  });

  it("falls back to the deterministic rendering when the prompt fails", async () => {
    const brokenClient = new OllamaClient({
      baseUrl,
      model: "test-model",
    });
    cannedResponse = "";
    const answer = {
      kind: "dead-code-check" as const,
      target: { id: "fn:src/api.js#ghost", type: "function", name: "ghost", path: "src/api.js" },
      verdict: "dead-candidate" as const,
      confidence: "confirmed-unreferenced" as const,
    };
    const text = await narrateAnswer(answer, brokenClient);
    expect(text).toContain("looks dead");
    cannedResponse = "ok";
  });

  it("reports unavailability and falls back cleanly when ollama is not running", async () => {
    const deadClient = new OllamaClient({ baseUrl: "http://127.0.0.1:9" });
    expect(await deadClient.isAvailable()).toBe(false);

    const answer = {
      kind: "dead-code-check" as const,
      target: { id: "fn:src/api.js#ghost", type: "function", name: "ghost", path: "src/api.js" },
      verdict: "dead-candidate" as const,
      confidence: "confirmed-unreferenced" as const,
    };
    expect(await deadClient.complete("anything")).toBeNull();

    const fallbackText =
      "(local model not available — showing raw result)\n\n" + renderAnswer(answer);
    expect(fallbackText).toContain("local model not available");
    expect(fallbackText).toContain("looks dead");
  });

  it("reads configuration from environment variables", () => {
    const previousUrl = process.env["MRI_OLLAMA_URL"];
    const previousModel = process.env["MRI_OLLAMA_MODEL"];
    process.env["MRI_OLLAMA_URL"] = "http://127.0.0.1:55001/";
    process.env["MRI_OLLAMA_MODEL"] = "mistral";

    try {
      const client = new OllamaClient();
      expect(client.baseUrl).toBe("http://127.0.0.1:55001");
      expect(client.model).toBe("mistral");
    } finally {
      if (previousUrl === undefined) delete process.env["MRI_OLLAMA_URL"];
      else process.env["MRI_OLLAMA_URL"] = previousUrl;
      if (previousModel === undefined) delete process.env["MRI_OLLAMA_MODEL"];
      else process.env["MRI_OLLAMA_MODEL"] = previousModel;
    }
  });
});

describe("reasoning end-to-end against a real graph", () => {
  const tmpRepo = mkdtempSync(path.join(os.tmpdir(), "mri-ollama-"));
  let store: GraphStore;

  beforeAll(async () => {
    await fs.cp(fixtureRoot, tmpRepo, { recursive: true });
    await buildRepoGraph(tmpRepo, path.join(tmpRepo, ".mri", "graph.sqlite"));
    store = openGraph(path.join(tmpRepo, ".mri", "graph.sqlite"));
  });

  it("produces the same structured answer regardless of narration availability", async () => {
    cannedResponse = "Ghost has no incoming references at all.";
    const ctx = buildReasoningContext(store, tmpRepo, 90);
    const parsed = parseQuestion("is ghost dead code");
    if (!parsed.ok || parsed.query.type !== "dead-code-check") throw new Error("parse failed");

    const answer = executeQuery(ctx, parsed.query);
    const withModel = new OllamaClient({ baseUrl, model: "test-model" });
    const withoutModel = new OllamaClient({ baseUrl: "http://127.0.0.1:9" });

    expect(await narrateAnswer(answer, withModel)).toBe(
      "Ghost has no incoming references at all.",
    );
    expect(await narrateAnswer(answer, withoutModel)).toContain("looks dead");
  });
});
