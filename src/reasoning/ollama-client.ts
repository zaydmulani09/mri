import type { LlmClient } from "./llm.js";

export interface OllamaClientOptions {
  baseUrl?: string;
  model?: string;
  availabilityTimeoutMs?: number;
  generationTimeoutMs?: number;
}

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_MODEL = "llama3.2";
const DEFAULT_AVAILABILITY_TIMEOUT_MS = 1500;
const DEFAULT_GENERATION_TIMEOUT_MS = 60000;

interface GenerateResponse {
  response?: string;
}

export class OllamaClient implements LlmClient {
  readonly baseUrl: string;
  readonly model: string;

  private availabilityTimeoutMs: number;
  private generationTimeoutMs: number;

  constructor(options: OllamaClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env["MRI_OLLAMA_URL"] ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.model = options.model ?? process.env["MRI_OLLAMA_MODEL"] ?? DEFAULT_MODEL;
    this.availabilityTimeoutMs =
      options.availabilityTimeoutMs ?? DEFAULT_AVAILABILITY_TIMEOUT_MS;
    this.generationTimeoutMs =
      options.generationTimeoutMs ?? DEFAULT_GENERATION_TIMEOUT_MS;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(this.availabilityTimeoutMs),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async complete(prompt: string): Promise<string | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
        }),
        signal: AbortSignal.timeout(this.generationTimeoutMs),
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as GenerateResponse;
      const text = payload.response;
      return typeof text === "string" && text.trim().length > 0 ? text : null;
    } catch {
      return null;
    }
  }
}
