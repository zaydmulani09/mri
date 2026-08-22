import { pingB } from "./b.js";

export function pingA() {
  return pingB();
}
