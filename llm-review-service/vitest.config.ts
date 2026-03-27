import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    // Integration tests share a single PostgreSQL database and use DELETE
    // between tests, so files must run sequentially to avoid race conditions.
    // vitest 0.34.x uses threads/maxThreads (not fileParallelism/singleFork).
    threads: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/server.ts"],
      reporter: ["text", "lcov"]
    }
  }
});
