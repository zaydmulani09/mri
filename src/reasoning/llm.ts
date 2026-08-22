export interface LlmClient {
  complete(prompt: string): Promise<string | null>;
}

export class NoLocalModel implements LlmClient {
  async complete(): Promise<string | null> {
    return null;
  }
}

// TODO(reasoning): plug in a local model here (e.g. Ollama at
// http://localhost:11434) by implementing LlmClient against its API and
// returning it from this factory. The reasoning pipeline is built so the
// model is only ever used to (1) map a question onto the supported query
// types below, constrained to that fixed set, and (2) reword a structured
// result it is handed verbatim. It never answers from its own knowledge.
export function createDefaultLlmClient(): LlmClient {
  return new NoLocalModel();
}
