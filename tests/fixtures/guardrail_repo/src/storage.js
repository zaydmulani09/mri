import { readFile } from 'node:fs';

export function loadSettings(path) {
  return readFile(path, 'utf8');
}
