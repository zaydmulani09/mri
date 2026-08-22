import type { BlastRadiusResult, GraphNode } from "./types.js";

interface Props {
  node: GraphNode | null;
  blast: BlastRadiusResult | null;
  loading: boolean;
  onSelect: (id: string) => void;
}

export function InspectorPanel({ node, blast, loading, onSelect }: Props) {
  if (!node) {
    return (
      <p className="placeholder">
        Click a node to inspect its blast radius. Solid green paths are proven by
        the graph; dashed amber marks are unresolved references the resolver could
        not tie to a specific target.
      </p>
    );
  }

  const confirmed = (blast?.dependents ?? []).filter((d) => d.via === "confirmed");
  const ambiguousOnly = (blast?.dependents ?? []).filter(
    (d) => d.via === "ambiguous-only",
  );

  return (
    <>
      <section className="section">
        <p className="eyebrow">SELECTED</p>
        <div className="mono" style={{ wordBreak: "break-all" }}>
          {node.id}
        </div>
        <div className="muted mono" style={{ fontSize: 11, marginTop: 4 }}>
          {node.type}
          {node.path ? ` · ${node.path}` : ""}
          {node.startLine !== null ? ` :${node.startLine}` : ""}
          {node.exported ? " · exported" : ""}
          {node.external ? " · external" : ""}
        </div>
      </section>

      <section className="section" aria-live="polite">
        <p className="eyebrow">
          BLAST RADIUS{" "}
          <span className="count">
            {loading ? "…" : `${blast?.dependents.length ?? 0}`}
          </span>
        </p>
        {loading ? <p className="placeholder">computing…</p> : null}
        {!loading && blast && confirmed.length === 0 && ambiguousOnly.length === 0 ? (
          <p className="placeholder">no dependents found in the graph.</p>
        ) : null}

        {!loading && confirmed.length > 0 ? (
          <>
            <p className="eyebrow">
              <span className="mark" style={{ verticalAlign: "middle" }} />
              CONFIRMED ({confirmed.length})
            </p>
            <table className="data">
              <tbody>
                {[...confirmed]
                  .sort((a, b) => a.depth - b.depth)
                  .map((d) => (
                    <tr key={d.id} className="rowlink" onClick={() => onSelect(d.id)}>
                      <td>
                        <span className="depth-chip">d{d.depth}</span>
                      </td>
                      <td>{d.id}</td>
                      <td className="muted">{d.relation}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </>
        ) : null}

        {!loading && ambiguousOnly.length > 0 ? (
          <>
            <p className="eyebrow" style={{ marginTop: 12 }}>
              <span className="mark dashed" style={{ verticalAlign: "middle" }} />
              AMBIGUOUS-ONLY ({ambiguousOnly.length})
            </p>
            <table className="data">
              <tbody>
                {ambiguousOnly.map((d) => (
                  <tr key={d.id} className="rowlink" onClick={() => onSelect(d.id)}>
                    <td>
                      <span className="depth-chip">d{d.depth}</span>
                    </td>
                    <td>{d.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted mono" style={{ fontSize: 11 }}>
              matched by name through an unresolved reference; not proven.
            </p>
          </>
        ) : null}
      </section>
    </>
  );
}
