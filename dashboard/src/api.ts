import type {
  AnalysisPayload,
  BlastRadiusResult,
  GraphPayload,
  MetaPayload,
} from "./types.js";

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} failed: ${response.status}`);
  return (await response.json()) as T;
}

export const api = {
  meta: () => getJson<MetaPayload>("/api/meta"),
  graph: () => getJson<GraphPayload>("/api/graph"),
  analysis: () => getJson<AnalysisPayload>("/api/analysis"),
  blastRadius: (id: string) =>
    getJson<BlastRadiusResult>(`/api/blast-radius?id=${encodeURIComponent(id)}`),
};
