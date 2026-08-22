import readline from "node:readline";
import { runTool, type McpContext } from "./tools.js";

export const MCP_PROTOCOL_VERSION = "2024-11-05";
export const MCP_SERVER_INFO = { name: "mri", version: "0.1.0" };

interface RpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const TOOL_DESCRIPTORS: ToolDescriptor[] = [
  {
    name: "blast-radius",
    description:
      "Everything that depends on the given node id (as printed by other mri tools), " +
      "by depth. Dependents are split into 'confirmed' (proven by resolved graph edges) " +
      "and 'ambiguous-only' (matched by name through unresolved references).",
    inputSchema: {
      type: "object",
      properties: { node_id: { type: "string" } },
      required: ["node_id"],
    },
  },
  {
    name: "is-dead-code",
    description:
      "Dead-code verdict for a node id with an explicit confidence label. Possible " +
      "verdicts: dead-candidate (with confidence tier), referenced, not-a-candidate, not-found.",
    inputSchema: {
      type: "object",
      properties: { node_id: { type: "string" } },
      required: ["node_id"],
    },
  },
  {
    name: "riskiest-files",
    description:
      "Files ranked by risk score (git churn plus missing-test penalty), highest first.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", default: 5 } },
    },
  },
  {
    name: "whats-not-tested",
    description:
      "Source files with no test coverage found, optionally filtered by a path prefix. " +
      "Import-proximity approximation, not runtime coverage.",
    inputSchema: {
      type: "object",
      properties: { scope: { type: "string" } },
    },
  },
  {
    name: "find-symbol",
    description:
      "Find internal functions/classes/methods by exact name, falling back to substring " +
      "match. Returns node ids usable with blast-radius and is-dead-code.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
];

function toolListPayload(): Record<string, unknown> {
  return { tools: TOOL_DESCRIPTORS };
}

function writeMessage(output: NodeJS.WritableStream, message: unknown): void {
  output.write(JSON.stringify(message) + "\n");
}

function result(id: RpcRequest["id"], payload: unknown): unknown {
  return { jsonrpc: "2.0", id, result: payload };
}

function error(id: RpcRequest["id"], code: number, message: string): unknown {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

// Handles a single parsed JSON-RPC message. Returns null for notifications
// (messages without an id) that produce no response.
export function handleRpcMessage(
  ctx: McpContext,
  message: RpcRequest,
): unknown | null {
  if (!message || typeof message.method !== "string") {
    return message && message.id !== undefined
      ? error(message.id, -32600, "invalid request: missing method")
      : null;
  }

  switch (message.method) {
    case "initialize":
      return result(message.id ?? null, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: MCP_SERVER_INFO,
      });
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return result(message.id ?? null, {});
    case "tools/list":
      return result(message.id ?? null, toolListPayload());
    case "tools/call": {
      const params = message.params ?? {};
      const toolName = params["name"];
      const args = (params["arguments"] ?? {}) as Record<string, unknown>;
      if (typeof toolName !== "string") {
        return error(message.id ?? null, -32602, "params.name must be a string");
      }
      try {
        const { structured } = runTool(ctx, toolName, args);
        return result(message.id ?? null, {
          content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        });
      } catch (toolError) {
        const messageText =
          toolError instanceof Error ? toolError.message : String(toolError);
        return result(message.id ?? null, {
          content: [{ type: "text", text: `error: ${messageText}` }],
          isError: true,
        });
      }
    }
    default:
      if (message.id === undefined || message.id === null) return null;
      return error(message.id, -32601, `method not found: ${message.method}`);
  }
}

// Attaches the JSON-RPC-over-newline transport to any readable/writable pair.
// Used with process.stdin/process.stdout by `mri mcp`, and with stream pairs
// by tests.
export function createMcpServer(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
  ctx: McpContext,
  onEnd?: () => void,
): void {
  const rl = readline.createInterface({ input });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    let parsed: RpcRequest;
    try {
      parsed = JSON.parse(trimmed) as RpcRequest;
    } catch {
      writeMessage(output, error(null, -32700, "parse error: invalid JSON"));
      return;
    }
    try {
      const response = handleRpcMessage(ctx, parsed);
      if (response !== null) writeMessage(output, response);
    } catch (internalError) {
      if (parsed.id === undefined || parsed.id === null) return;
      writeMessage(
        output,
        error(
          parsed.id,
          -32603,
          `internal error: ${internalError instanceof Error ? internalError.message : String(internalError)}`,
        ),
      );
    }
  });
  rl.on("close", () => {
    output.end();
    onEnd?.();
  });
}
