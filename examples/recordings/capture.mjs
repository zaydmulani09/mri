#!/usr/bin/env node
// Scripted terminal capture: runs real commands, captures their real
// stdout/stderr bytes, and emits an asciinema v2 (.cast) file plus a plain
// .txt transcript. Pacing delays affect event TIMESTAMPS only - every byte
// of output content comes from the recorded process, in captured order.
//
// Usage: node capture.mjs <scenario.json> <out-prefix>

import { spawn } from "node:child_process";
import { createWriteStream, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const [scenarioPath, outPrefix] = process.argv.slice(2);
if (!scenarioPath || !outPrefix) {
  console.error("usage: node capture.mjs <scenario.json> <out-prefix>");
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const scenario = JSON.parse(readFileSync(path.resolve(here, scenarioPath), "utf8"));

const width = scenario.width ?? 100;
const height = scenario.height ?? 32;
const defaultLineDelay = scenario.lineDelay ?? 90;

const castPath = `${outPrefix}.cast`;
const txtPath = `${outPrefix}.txt`;
const cast = createWriteStream(castPath, { encoding: "utf8" });
const txt = createWriteStream(txtPath, { encoding: "utf8" });

let clockMs = 0;
let writeQueue = Promise.resolve();
const enqueue = (fn) => {
  writeQueue = writeQueue.then(fn);
  return writeQueue;
};
const emit = (data) => {
  const t = clockMs / 1000;
  cast.write(`${JSON.stringify([Number(t.toFixed(6)), "o", data])}\n`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function advance(ms) {
  await sleep(Math.min(ms, 2000));
  clockMs += ms;
}
function writeLine(line, delay) {
  emit(`${line}\n`);
  txt.write(`${line}\n`);
  return advance(delay ?? defaultLineDelay);
}

async function runStep(step) {
  const delay = step.lineDelay ?? defaultLineDelay;
  const cwd = step.cwd ? path.resolve(repoRoot, step.cwd) : repoRoot;
  if (step.pauseBefore) await advance(step.pauseBefore);
  await enqueue(() => writeLine(`$ ${step.cmd.join(" ")}`, 350));

  await new Promise((resolve) => {
    const child = spawn(step.cmd[0], step.cmd.slice(1), { cwd, shell: false });
    let buffer = "";
    const pump = (chunk) => {
      buffer += chunk.toString("utf8");
      let idx;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        enqueue(() => writeLine(line, delay));
      }
    };
    child.stdout.on("data", pump);
    child.stderr.on("data", pump);
    child.on("close", () => {
      if (buffer.length > 0) enqueue(() => writeLine(buffer, delay));
      setTimeout(resolve, Math.max(delay * 4, 400));
    });
  });
}

cast.write(
  `${JSON.stringify({
    version: 2,
    width,
    height,
    duration: 0,
    command: "-",
    title: scenario.title,
    env: { SHELL: "powershell", TERM: "xterm-256color" },
  })}\n`,
);

for (const step of scenario.steps) {
  await runStep(step);
}

await enqueue(() => {});
await advance(800);
cast.end();

await writeQueue;
const raw = readFileSync(castPath, "utf8").split("\n");
const header = JSON.parse(raw[0]);
header.duration = Number((clockMs / 1000).toFixed(3));
raw[0] = JSON.stringify(header);
writeFileSync(castPath, raw.join("\n"), "utf8");
console.log(`wrote ${castPath} and ${txtPath} (${header.duration}s)`);
