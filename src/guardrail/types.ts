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

export type ResourceCategoryName =
  | "filesystem"
  | "network"
  | "environment"
  | "subprocess";

export const RESOURCE_CATEGORY_NAMES: readonly ResourceCategoryName[] = [
  "filesystem",
  "network",
  "environment",
  "subprocess",
];

/**
 * A category-capability grant: proof that the scope touches this resource
 * KIND, without any specific path/host/variable/command target. Produced by
 * deriving from resolved builtin-module imports in the graph, or declared
 * manually in a resource config when callers want to grant a whole category.
 */
export interface CategoryGrant {
  category: ResourceCategoryName;
  /** Module import that evidenced this need, e.g. "node:fs". */
  viaModule: string;
  origin: "graph-import" | "config";
}

export interface ResourceGrants {
  filesystem: FilesystemGrant[];
  network: NetworkGrant[];
  environment: EnvironmentGrant[];
  subprocess: SubprocessGrant[];
  categoryLevel?: CategoryGrant[];
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
  /**
   * The subset of `resources.categoryLevel` that was derived from the graph
   * (as opposed to declared via config). Empty when the graph confirms no
   * resource-category needs for this scope.
   */
  derivedResources: CategoryGrant[];
  unresolved: UnresolvedReference[];
}
