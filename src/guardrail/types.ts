import type { EdgeTypeValue } from "../graph/schema.js";

export const ALLOWLIST_POLICY = "fail-closed" as const;

export type ResourceAccessMode = "read" | "write";

export type NetworkProtocol = "http" | "https" | "tcp" | "udp";

export interface FilesystemGrant {
  path: string;
  access: ResourceAccessMode[];
}

export interface NetworkGrant {
  host: string;
  port?: number;
  protocols?: NetworkProtocol[];
}

export interface EnvironmentGrant {
  name: string;
  access: ResourceAccessMode;
}

export interface SubprocessGrant {
  commands: string[];
}

export interface ResourceGrants {
  filesystem: FilesystemGrant[];
  network: NetworkGrant[];
  environment: EnvironmentGrant[];
  subprocess: SubprocessGrant[];
}

export interface ScopedResourceConfig {
  scopes: Record<string, ResourceGrants>;
}

export interface ScopeInfo {
  id: string;
  type: string;
  name: string;
  path: string | null;
}

export interface SymbolGrant {
  nodeId: string;
  name: string;
  kind: string;
  path: string | null;
  external: boolean;
  via: EdgeTypeValue;
}

export interface FileGrant {
  nodeId: string;
  path: string;
}

export interface UnresolvedReference {
  sourceId: string;
  calleeText: string;
  line: number | null;
}

export interface Allowlist {
  policy: typeof ALLOWLIST_POLICY;
  scope: ScopeInfo;
  symbols: SymbolGrant[];
  files: FileGrant[];
  resources: ResourceGrants;
  unresolved: UnresolvedReference[];
}
