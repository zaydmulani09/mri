import { pipeline } from "./util.js";

export type * from "./types.js";
export type * as ns from "./more.js";

export function sendRequest(url: string): Promise<number> {
  return Promise.resolve(1);
}

export class Requester {
  send() {
    return 1;
  }
}
