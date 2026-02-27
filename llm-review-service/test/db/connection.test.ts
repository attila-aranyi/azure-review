import { describe, it, expect, afterEach } from "vitest";
import { getDb } from "../../src/db/connection";

describe("DB connection", () => {
  it("getDb() throws if not initialized", () => {
    expect(() => getDb()).toThrow("Database not initialized");
  });

  // Full integration tests require a running PostgreSQL instance
  // They are guarded behind DATABASE_URL env var
  // See test/db/repos/*.test.ts for integration tests
});
