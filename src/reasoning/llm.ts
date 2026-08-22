import { OllamaClient } from "./ollama-client.js";

export interface LlmClient {
  complete(prompt: string): Promise<string | null>;
  isAvailable?(): Promise<boolean>;
}

export class NoLocalModel implements LlmClient {
  async complete(): Promise<string | null> {
    return null;
  }
  async isAvailable(): Promise<boolean> {
    return false;
  }
}

export function createDefaultLlmClient(): LlmClient {
  return new OllamaClient();
}
