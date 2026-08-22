import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Fixture repos under tests/fixtures/ and examples/recordings/fixture/
    // carry fake package names and intentionally broken sources; they must
    // never be picked up as suites by the default **/*.test.* glob.
    exclude: [
      ...configDefaults.exclude,
      "tests/fixtures/**",
      "examples/recordings/fixture/**",
      // All of examples/ is demo and payload material; nothing there is a
      // suite today, and future capture fixtures must not become one.
      "examples/**",
      // Compiled build output. tsc emits src/*.test.ts as out/*.test.js
      // (vscode-extension/out) and vite emits dist bundles; compiled test
      // artifacts must never be rediscovered as suites.
      "**/out/**",
      "**/dist/**",
    ],
  },
});
