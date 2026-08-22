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
    ],
  },
});
