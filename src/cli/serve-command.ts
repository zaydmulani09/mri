import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  buildRepoGraph,
  openGraph,
  type GraphStore,
} from "../graph/index.js";
import {
  findDeadCode,
  mapTestCoverage,
  collectGitHistory,
  scoreFileRisks,
  computeBlastRadius,
} from "../analysis/index.js";
import type { NodeRow } from "../graph/store.js";

export interface ServeCommandArgs {
  repoPath: string;
  port: number;
  openBrowser: boolean;
}

export interface ServeContext {
  store: GraphStore;
  repoRoot: string;
  graphJson: unknown;
  analysisJson: unknown;
  metaJson: unknown;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

export async function prepareServeContext(
  repoPath: string,
): Promise<ServeContext> {
  const repoRoot = path.resolve(repoPath);
  await buildRepoGraph(repoRoot, path.join(repoRoot, ".mri", "graph.sqlite"));
  const store = openGraph(path.join(repoRoot, ".mri", "graph.sqlite"));

  const graph = buildGraphPayload(store);
  const deadCode = findDeadCode(store);
  const coverage = mapTestCoverage(store);
  const history = collectGitHistory(repoRoot, 90);
  const risks = scoreFileRisks(history, coverage, 90);

  return {
    store,
    repoRoot,
    graphJson: graph,
    analysisJson: { deadCode, coverage, risks },
    metaJson: {
      root: repoRoot.split(path.sep).join("/"),
      generatedAt: new Date().toISOString(),
      fileCount: graph.nodes.filter((n) => n.type === "file").length,
      counts: store.counts(),
      windowDays: 90,
    },
  };
}

export function buildGraphPayload(store: GraphStore): {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
} {
  const nodes = (
    store.db.prepare("SELECT * FROM nodes ORDER BY id").all() as unknown as NodeRow[]
  ).map((n) => ({
    id: n.id,
    type: n.type,
    name: n.name,
    path: n.path,
    startLine: n.start_line,
    endLine: n.end_line,
    external: n.external === 1,
    exported: n.exported === 1,
    language: n.language,
  }));
  const edges = store.db
    .prepare(
      `SELECT src, dst, type, line, callee_text AS calleeText, confidence
       FROM edges`,
    )
    .all();
  return { nodes, edges };
}

export function createGraphServer(ctx: ServeContext, dashboardDist: string): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (url.pathname === "/api/graph") {
        return json(res, ctx.graphJson);
      }
      if (url.pathname === "/api/analysis") {
        return json(res, ctx.analysisJson);
      }
      if (url.pathname === "/api/meta") {
        return json(res, ctx.metaJson);
      }
      if (url.pathname === "/api/blast-radius") {
        const id = url.searchParams.get("id");
        if (!id) return json(res, { error: "missing id" }, 400);
        if (!ctx.store.getNode(id)) {
          return json(res, { error: `unknown node id: ${id}` }, 404);
        }
        return json(res, computeBlastRadius(ctx.store, id));
      }

      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405).end();
        return;
      }
      return await serveStatic(dashboardDist, url.pathname, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      json(res, { error: message }, 500);
    }
  });
}

function json(res: http.ServerResponse, payload: unknown, status = 200): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(body);
}

async function serveStatic(rootDir: string, pathname: string, res: http.ServerResponse): Promise<void> {
  let relativePath = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (relativePath === "") relativePath = "index.html";

  const absolute = path.resolve(rootDir, relativePath);
  if (!absolute.startsWith(path.resolve(rootDir))) {
    res.writeHead(403).end();
    return;
  }

  let target = absolute;
  try {
    const stat = await fs.stat(target).catch(() => null);
    if (!stat || stat.isDirectory()) {
      target = path.join(rootDir, "index.html");
    }
    const body = await fs.readFile(target);
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "cache-control": target.includes(`${path.sep}assets${path.sep}`)
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
}

export function openBrowser(url: string): void {
  const platform = process.platform;
  try {
    if (platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else if (platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    process.stderr.write(`(could not launch a browser — open ${url} manually)\n`);
  }
}
