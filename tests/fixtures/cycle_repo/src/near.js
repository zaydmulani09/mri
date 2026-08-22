import { helper } from "cycle-nearmiss-pkg";
import { pingA } from "./a.js";

// Looks like it could close a loop with the package it imports, but that
// specifier resolves to an external module with no outgoing edges, so this
// file must NOT participate in any reported cycle.
export function nearEntry() {
  return helper(pingA());
}
