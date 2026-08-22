import { landing } from "./f.js";

export function hop() {
  return landing({ hop: () => 1 });
}
