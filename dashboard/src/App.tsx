import { useEffect, useState } from "react";
import { api } from "./api.js";
import type {
  AnalysisPayload,
  BlastRadiusResult,
  GraphPayload,
  MetaPayload,
} from "./types.js";
import { GraphView } from "./GraphView.js";
import { InspectorPanel } from "./InspectorPanel.js";
import { TablesView } from "./TablesView.js";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | {
      phase: "ready";
      meta: MetaPayload;
      graph: GraphPayload;
      analysis: AnalysisPayload;
    };

export default function App() {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [blast, setBlast] = useState<BlastRadiusResult | null>(null);
  const [blastLoading, setBlastLoading] = useState(false);
  const [view, setView] = useState<"graph" | "tables">("graph");

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.meta(), api.graph(), api.analysis()])
      .then(([meta, graph, analysis]) => {
        if (!cancelled) setState({ phase: "ready", meta, graph, analysis });
      })
      .catch((error: Error) => {
        if (!cancelled) setState({ phase: "error", message: error.message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setBlast(null);
      return;
    }
    let cancelled = false;
    setBlastLoading(true);
    api
      .blastRadius(selectedId)
      .then((result) => {
        if (!cancelled) setBlast(result);
      })
      .catch(() => {
        if (!cancelled) setBlast(null);
      })
      .finally(() => {
        if (!cancelled) setBlastLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  if (state.phase === "loading") {
    return <div className="placeholder">building graph…</div>;
  }
  if (state.phase === "error") {
    return <div className="notice">failed to load graph data: {state.message}</div>;
  }

  const edgesByType = state.meta.counts.edgesByType;
  const totalEdges = Object.values(edgesByType).reduce<number>(
    (sum, n) => sum + n,
    0,
  );
  const resolvedEdges = state.meta.counts.edgesByConfidence.resolved ?? 0;
  const ambiguousEdges = state.meta.counts.edgesByConfidence.ambiguous ?? 0;
  const parseErrorFiles = state.meta.parseErrorFiles ?? 0;

  return (
    <div className="app">
      <header className="strip" aria-label="graph status">
        <span className="brand">MRI</span>
        <span className="seg">
          repo <b>{state.meta.root.split("/").pop()}</b>
        </span>
        <span className="seg">
          nodes <b>{state.graph.nodes.length}</b>
        </span>
        <span className="seg">
          edges <b>{totalEdges}</b>
        </span>
        <span className="seg">
          resolved <b>{resolvedEdges}</b>
        </span>
        <span className="seg">
          ambiguous <b>{ambiguousEdges}</b>
        </span>
        <span className="seg">
          files <b>{state.meta.fileCount}</b>
        </span>
        {parseErrorFiles > 0 ? (
          <span className="seg warn">
            parse errors <b>{parseErrorFiles}</b>
          </span>
        ) : null}
        <span className="seg">
          built{" "}
          <b>{new Date(state.meta.generatedAt).toLocaleTimeString()}</b>
        </span>
        <span style={{ flex: 1 }} />
        <span className="seg">
          <a href="/api/graph" target="_blank" rel="noopener noreferrer">
            /api/graph
          </a>
        </span>
      </header>

      <main className="main">
        {view === "graph" ? (
          <>
            <section className="viewport" aria-label="dependency graph">
              <GraphView
                graph={state.graph}
                selectedId={selectedId}
                onSelect={setSelectedId}
                blast={blast}
              />
            </section>
            <aside className="rail" aria-label="inspector">
              <InspectorPanel
                node={state.graph.nodes.find((n) => n.id === selectedId) ?? null}
                blast={blast}
                loading={blastLoading}
                onSelect={setSelectedId}
              />
            </aside>
          </>
        ) : (
          <section className="viewport" aria-label="tables">
            <TablesView analysis={state.analysis} />
          </section>
        )}
      </main>

      <nav className="tabs" aria-label="views" style={{ borderTop: "1px solid var(--border)" }}>
        <button aria-selected={view === "graph"} onClick={() => setView("graph")}>
          GRAPH
        </button>
        <button aria-selected={view === "tables"} onClick={() => setView("tables")}>
          TABLES
        </button>
      </nav>
    </div>
  );
}
