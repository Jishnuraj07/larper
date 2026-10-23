import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests that spawn PowerShell (runShell, the heist's git diff) can take several
    // seconds each on a cold Windows CI runner; vitest's 5s default is too tight.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
