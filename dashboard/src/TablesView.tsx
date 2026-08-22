import type { AnalysisPayload } from "./types.js";

export function TablesView({ analysis }: { analysis: AnalysisPayload }) {
  return (
    <div style={{ padding: "16px 24px" }}>
      <DeadCode analysis={analysis} />
      <Risk analysis={analysis} />
      <Coverage analysis={analysis} />
    </div>
  );
}

function DeadCode({ analysis }: { analysis: AnalysisPayload }) {
  const order = { "confirmed-unreferenced": 0, "referenced-but-uncalled": 1, "no-resolved-references": 2 };
  const rows = [...analysis.deadCode].sort(
    (a, b) => order[a.confidence] - order[b.confidence] || a.path.localeCompare(b.path),
  );
  return (
    <section className="section">
      <p className="eyebrow">
        DEAD CODE CANDIDATES <span className="count">{rows.length}</span> · confidence
        labeled, never guessed
      </p>
      <table className="data">
        <thead>
          <tr>
            <th>confidence</th>
            <th>symbol</th>
            <th>kind</th>
            <th>path</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td className={`conf ${c.confidence}`}>
                <span
                  className={
                    "mark" + (c.confidence === "no-resolved-references" ? " dashed" : "")
                  }
                />
                {c.confidence.replace(/-/g, " ")}
              </td>
              <td>{c.id}</td>
              <td>{c.type}</td>
              <td className="muted">{c.path}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                none found within current rules.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function Risk({ analysis }: { analysis: AnalysisPayload }) {
  const top = analysis.risks.slice(0, 10);
  return (
    <section className="section">
      <p className="eyebrow">RISK HOTSPOTS · churn + missing tests, components shown</p>
      <table className="data">
        <thead>
          <tr>
            <th>file</th>
            <th className="num">score</th>
            <th className="num">churn commits</th>
            <th className="num">churn pts</th>
            <th className="num">coverage pts</th>
            <th>tests</th>
            <th>last modified</th>
          </tr>
        </thead>
        <tbody>
          {top.map((r) => (
            <tr key={r.path}>
              <td>{r.path}</td>
              <td className="num">{r.score}</td>
              <td className="num">{r.components.churnCommits}</td>
              <td className="num">{r.churnPoints}</td>
              <td className="num">{r.coveragePenalty}</td>
              <td>{r.components.hasTests ? "yes" : "no"}</td>
              <td className="muted mono">
                {r.components.lastModifiedIso?.slice(0, 10) ?? "untracked"}
              </td>
            </tr>
          ))}
          {top.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                no files analyzed yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function Coverage({ analysis }: { analysis: AnalysisPayload }) {
  const c = analysis.coverage;
  return (
    <section className="section">
      <p className="eyebrow">
        TEST COVERAGE{" "}
        <span className="count">
          {(c.coverageRatio * 100).toFixed(1)}% ({c.coveredFiles.length}/
          {c.sourceFiles.length} files)
        </span>{" "}
        · import-based approximation
      </p>
      <table className="data">
        <thead>
          <tr>
            <th>test file</th>
            <th>exercises</th>
          </tr>
        </thead>
        <tbody>
          {c.exercises.map((e) => (
            <tr key={e.testFile}>
              <td>{e.testFile}</td>
              <td className="muted">{e.covers.join(", ") || "nothing internal"}</td>
            </tr>
          ))}
          {c.exercises.length === 0 && (
            <tr>
              <td colSpan={2} className="muted">
                no test files matched the configured patterns.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
