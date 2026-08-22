import { boot } from './utils/helpers';

const VERSION = '1.0.0';

export function main(argv) {
  return boot(argv, VERSION);
}

export default class App {
  start() {
    return main([]);
  }
}
