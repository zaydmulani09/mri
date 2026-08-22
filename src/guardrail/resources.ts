import { promises as fs } from "node:fs";
import type {
  EnvironmentGrant,
  FilesystemGrant,
  NetworkGrant,
  NetworkProtocol,
  ResourceAccessMode,
  ResourceGrants,
  ScopedResourceConfig,
  SubprocessGrant,
} from "./types.js";

const ACCESS_MODES: readonly ResourceAccessMode[] = ["read", "write"];
const PROTOCOLS: readonly NetworkProtocol[] = ["http", "https", "tcp", "udp"];

const RESOURCE_CATEGORIES = ["filesystem", "network", "environment", "subprocess"] as const;
type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number];

export function emptyResourceGrants(): ResourceGrants {
  return { filesystem: [], network: [], environment: [], subprocess: [] };
}

export function parseResourceConfig(raw: unknown): ScopedResourceConfig {
  const root = requireRecord(raw, "resource config");
  const scopesRaw = root["scopes"];
  if (scopesRaw === undefined) {
    throw new Error("resource config must have a 'scopes' object");
  }
  const scopesRecord = requireRecord(scopesRaw, "resource config 'scopes'");
  const scopes: Record<string, ResourceGrants> = {};
  for (const [scopeId, grantsRaw] of Object.entries(scopesRecord)) {
    if (scopeId.length === 0) {
      throw new Error("resource config scope ids must be non-empty");
    }
    scopes[scopeId] = normalizeResourceGrants(grantsRaw, `scope '${scopeId}'`);
  }
  return { scopes };
}

export async function loadResourceConfig(configPath: string): Promise<ScopedResourceConfig> {
  let text: string;
  try {
    text = await fs.readFile(configPath, "utf8");
  } catch (error) {
    throw new Error(`cannot read resource config '${configPath}': ${(error as Error).message}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`resource config '${configPath}' is not valid JSON: ${(error as Error).message}`);
  }
  return parseResourceConfig(raw);
}

export function normalizeResourceGrants(raw: unknown, context: string): ResourceGrants {
  const record = requireRecord(raw, context);
  for (const key of Object.keys(record)) {
    if (!RESOURCE_CATEGORIES.includes(key as ResourceCategory)) {
      throw new Error(`${context}: unknown resource category '${key}'`);
    }
  }
  return {
    filesystem: normalizeFilesystem(record["filesystem"], context),
    network: normalizeNetwork(record["network"], context),
    environment: normalizeEnvironment(record["environment"], context),
    subprocess: normalizeSubprocess(record["subprocess"], context),
  };
}

function normalizeFilesystem(raw: unknown, context: string): FilesystemGrant[] {
  if (raw === undefined) return [];
  const entries = requireArray(raw, `${context}.filesystem`);
  return entries.map((entry, i) => {
    const ctx = `${context}.filesystem[${i}]`;
    const record = requireRecord(entry, ctx);
    requireKeys(record, ["path", "access"], ctx);
    const path = requireNonEmptyString(record["path"], `${ctx}.path`);
    const access = requireAccessModes(record["access"], `${ctx}.access`);
    return { path, access };
  });
}

function normalizeNetwork(raw: unknown, context: string): NetworkGrant[] {
  if (raw === undefined) return [];
  const entries = requireArray(raw, `${context}.network`);
  return entries.map((entry, i) => {
    const ctx = `${context}.network[${i}]`;
    const record = requireRecord(entry, ctx);
    requireKeys(record, ["host", "port", "protocols"], ctx);
    const host = requireNonEmptyString(record["host"], `${ctx}.host`);
    const grant: NetworkGrant = { host };
    if (record["port"] !== undefined) {
      const port = record["port"];
      if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`${ctx}.port must be an integer between 1 and 65535`);
      }
      grant.port = port;
    }
    if (record["protocols"] !== undefined) {
      grant.protocols = requireEnumList(
        record["protocols"],
        PROTOCOLS,
        `${ctx}.protocols`,
      ) as NetworkProtocol[];
    }
    return grant;
  });
}

function normalizeEnvironment(raw: unknown, context: string): EnvironmentGrant[] {
  if (raw === undefined) return [];
  const entries = requireArray(raw, `${context}.environment`);
  return entries.map((entry, i) => {
    const ctx = `${context}.environment[${i}]`;
    const record = requireRecord(entry, ctx);
    requireKeys(record, ["name", "access"], ctx);
    const name = requireNonEmptyString(record["name"], `${ctx}.name`);
    const access = requireEnum(record["access"], ACCESS_MODES, `${ctx}.access`) as ResourceAccessMode;
    return { name, access };
  });
}

function normalizeSubprocess(raw: unknown, context: string): SubprocessGrant[] {
  if (raw === undefined) return [];
  const entries = requireArray(raw, `${context}.subprocess`);
  return entries.map((entry, i) => {
    const ctx = `${context}.subprocess[${i}]`;
    const record = requireRecord(entry, ctx);
    requireKeys(record, ["commands"], ctx);
    const commands = requireStringArray(record["commands"], `${ctx}.commands`);
    if (commands.length === 0) {
      throw new Error(`${ctx}.commands must list at least one command; an empty list would silently mean 'any'`);
    }
    return { commands };
  });
}

function requireRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${context} must be an array`);
  }
  return value;
}

function requireKeys(record: Record<string, unknown>, keys: readonly string[], context: string): void {
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) {
      throw new Error(`${context}: unknown field '${key}'`);
    }
  }
}

function requireNonEmptyString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${context} must be a non-empty string`);
  }
  return value;
}

function requireStringArray(value: unknown, context: string): string[] {
  const entries = requireArray(value, context);
  return entries.map((entry, i) => requireNonEmptyString(entry, `${context}[${i}]`));
}

function requireEnum(value: unknown, allowed: readonly string[], context: string): string {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${context} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

function requireEnumList(value: unknown, allowed: readonly string[], context: string): string[] {
  const entries = requireArray(value, context).map((entry, i) =>
    requireEnum(entry, allowed, `${context}[${i}]`),
  );
  if (entries.length === 0) {
    throw new Error(`${context} must not be empty`);
  }
  return [...new Set(entries)];
}

function requireAccessModes(value: unknown, context: string): ResourceAccessMode[] {
  const modes = requireEnumList(value, ACCESS_MODES, context) as ResourceAccessMode[];
  modes.sort();
  return modes;
}
