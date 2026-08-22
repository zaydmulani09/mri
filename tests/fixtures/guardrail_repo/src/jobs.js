import { exec } from 'child_process';

export function runJob(cmd) {
  return exec(cmd);
}
