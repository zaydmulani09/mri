export type BreachKind =
  | "parse-failure"
  | "disallowed-import"
  | "unverifiable-import"
  | "ungranted-resource"
  | "unverifiable-resource"
  | "unknown-reference"
  | "denied-unclassifiable";

export type AllowlistArea =
  | "symbols"
  | "files"
  | "resources.filesystem"
  | "resources.network"
  | "resources.environment"
  | "resources.subprocess";

export interface ContainmentBreach {
  kind: BreachKind;
  line: number;
  attempted: string;
  rule: { area: AllowlistArea; expected: string } | null;
  message: string;
}

export type CheckAndRunResult =
  | { outcome: "blocked"; breaches: ContainmentBreach[] }
  | { outcome: "executed"; value: unknown };
