import { beforeAll, describe, expect, it } from "vitest";
import { promises as fs, mkdtempSync } from "node:fs";
import { PassThrough } from "node:stream";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRepoGraph, openGraph, type GraphStore } from "../src/graph/index.js";
import { computeBlastRadius, scoreFileRisks } from "../src/analysis/index.js";
import { buildReasoningContext } from "../src/reasoning/index.js";
import {
  createMcpServer,
  handleRpcMessage,
  mcpContextFromReasoning,
  TOOL_DESCRIPTORS,
  type McpContext,
} from "../src/mcp/index.js";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "analysis_repo",
);

function rpc(id: number, method: string, params?: Record<string, unknown>) {
  return { jsonrpc: "2.0", id, method, params };
}

function callTool(ctx: McpContext, name: string, args: Record<string, unknown>) {
  return handleRpcMessage(ctx, rpc(1, "tools/call", { name, arguments: args })) as {
    result: {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
  };
}

function toolPayload(ctx: McpContext, name: string, args: Record<string, unknown>): unknown {
  const response = callTool(ctx, name, args);
  expect(response.result.isError).toBeUndefined();
  return JSON.parse(response.result.content[0]?.text ?? "{}");
}

describe("mcp server", () => {
  const tmpRepo = mkdtempSync(path.join(os.tmpdir(), "mri-mcp-"));
  let ctx: McpContext;
  let store: GraphStore;

  beforeAll(async () => {
    await fs.cp(fixtureRoot, tmpRepo, { recursive: true });
    await buildRepoGraph(tmpRepo, path.join(tmpRepo, ".mri", "graph.sqlite"));
    store = openGraph(path.join(tmpRepo, ".mri", "graph.sqlite"));
    ctx = mcpContextFromReasoning(buildReasoningContext(store, tmpRepo, 90));
  });

  it("responds to initialize with protocol version and tool capabilities", () => {
    const response = handleRpcMessage(ctx, rpc(1, "initialize", {})) as {
      result: { protocolVersion: string; capabilities: { tools: object }; serverInfo: { name: string } };
    };
    expect(response.result.protocolVersion).toBe("2024-11-05");
    expect(response.result.capabilities.tools).toEqual({});
    expect(response.result.serverInfo.name).toBe("mri");
  });

  it("lists exactly the five supported tools", () => {
    const response = handleRpcMessage(ctx, rpc(2, "tools/list")) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(response.result.tools.map((t) => t.name).sort()).toEqual([
      "blast-radius",
      "find-symbol",
      "is-dead-code",
      "riskiest-files",
      "whats-not-tested",
    ]);
    expect(TOOL_DESCRIPTORS).toHaveLength(5);
  });

  it("returns null for notifications and method-not-found for unknown methods", () => {
    expect(handleRpcMessage(ctx, { method: "notifications/initialized" })).toBeNull();
    const response = handleRpcMessage(ctx, rpc(9, "no/such/method")) as {
      error: { code: number };
    };
    expect(response.error.code).toBe(-32601);
  });

  it("find-symbol resolves the same node id the graph stores", () => {
    const payload = toolPayload(ctx, "find-symbol", { name: "ghost" }) as {
      count: number;
      matches: Array<{ id: string }>;
    };
    expect(payload.count).toBe(1);
    expect(payload.matches[0]?.id).toBe("fn:src/api.js#ghost");
  });

  it("returns blast radius identical to computeBlastRadius for the same node", () => {
    const nodeId = "fn:src/format.js#pad";
    const payload = toolPayload(ctx, "blast-radius", { node_id: nodeId });
    const direct = computeBlastRadius(store, nodeId);
    expect(payload).toEqual({ ...direct, note: expect.any(String) });
  }, 30000);

  it("matches riskiest-files output to the risk scoring used by mri analyze", () => {
    const payload = toolPayload(ctx, "riskiest-files", { limit: 3 }) as {
      files: Array<{ path: string; score: number }>;
      windowDays: number;
    };
    const direct = scoreFileRisks(ctx.history, ctx.coverage, 90).slice(0, 3);
    expect(payload.files).toEqual(
      direct.map((r) => ({
        path: r.path,
        score: r.score,
        churnCommits: r.components.churnCommits,
        hasTests: r.components.hasTests,
        lastModifiedIso: r.components.lastModifiedIso,
      })),
    );
  });

  it("filters untested files by scope prefix", () => {
    const all = toolPayload(ctx, "whats-not-tested", {}) as { uncoveredFiles: string[] };
    const scoped = toolPayload(ctx, "whats-not-tested", { scope: "py" }) as {
      uncoveredFiles: string[];
    };
    expect(scoped.uncoveredFiles.length).toBeGreaterThan(0);
    expect(scoped.uncoveredFiles.every((f) => f.startsWith("py"))).toBe(true);
    expect(scoped.uncoveredFiles.length).toBeLessThan(all.uncoveredFiles.length);
  });

  it("reports dead-code verdicts consistent with findDeadCode tiers", () => {
    const ghost = toolPayload(ctx, "is-dead-code", { node_id: "fn:src/api.js#ghost" }) as {
      verdict: string;
      confidence?: string;
    };
    expect(ghost.verdict).toBe("dead-candidate");
    expect(ghost.confidence).toBe("confirmed-unreferenced");

    const lateNoop = toolPayload(ctx, "is-dead-code", {
      node_id: "fn:src/callbacks.js#lateNoop",
    }) as { verdict: string; confidence?: string };
    expect(lateNoop.confidence).toBe("referenced-but-uncalled");

    const alive = toolPayload(ctx, "is-dead-code", { node_id: "fn:src/api.js#fetchUser" }) as {
      verdict: string;
    };
    expect(alive.verdict).toBe("referenced");
  });

  it("surfaces tool errors as isError content instead of crashing", () => {
    const response = callTool(ctx, "blast-radius", { node_id: "fn:does/not#exist" });
    expect(response.result.isError).toBe(true);
    expect(response.result.content[0]?.text).toContain("unknown node id");
  });

  it("round-trips newline-delimited jsonrpc over streams and survives malformed input", async () => {
    const incoming = new PassThrough();
    const outgoing = new PassThrough();
    createMcpServer(incoming, outgoing, ctx);

    const received: unknown[] = [];
    const collector = new Promise<void>((resolve) => {
      let buffer = "";
      outgoing.on("data", (chunk) => {
        buffer += chunk.toString();
        let idx;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (line.length > 0) {
            received.push(JSON.parse(line));
          }
          if (received.length >= 3) resolve();
        }
      });
    });

    incoming.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
    incoming.write("this is not json\n");
    incoming.write('{"jsonrpc":"2.0","id":2,"method":"ping"}\n');
    incoming.end();

    await collector;
    expect(received).toHaveLength(3);
    expect((received[0] as { id: number }).id).toBe(1);
    expect((received[1] as { error: { code: number } }).error.code).toBe(-32700);
    expect((received[2] as { id: number }).id).toBe(2);
  }, 30000);
});
