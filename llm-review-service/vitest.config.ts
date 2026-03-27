import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    // Integration tests share a single PostgreSQL database and use TRUNCATE
    // between tests, so files must run sequentially to avoid race conditions.
    fileParallelism: false,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/server.ts"],
      reporter: ["text", "lcov"]
    }
  }
});
