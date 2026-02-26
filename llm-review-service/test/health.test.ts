import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { registerHealthRoutes } from "../src/routes/health";
import type { ReviewQueue } from "../src/review/queue";

function makeQueue(enabled: boolean, pingResult = true): ReviewQueue {
  return {
    enabled,
    enqueue: vi.fn(async () => {}),
    ping: vi.fn(async () => pingResult),
    close: vi.fn(async () => {})
  };
}

describe("health routes", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it("GET /health returns 200", async () => {
    app = Fastify({ logger: false });
    await app.register(registerHealthRoutes, { queue: makeQueue(false) });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("GET /ready returns 200 when queue is disabled", async () => {
    app = Fastify({ logger: false });
    await app.register(registerHealthRoutes, { queue: makeQueue(false) });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ready" });
  });

  it("GET /ready returns 200 when queue is enabled and Redis is reachable", async () => {
    app = Fastify({ logger: false });
    await app.register(registerHealthRoutes, { queue: makeQueue(true, true) });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ready" });
  });

  it("GET /ready returns 503 when Redis is unreachable", async () => {
    app = Fastify({ logger: false });
    await app.register(registerHealthRoutes, { queue: makeQueue(true, false) });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "not ready", reason: "redis unreachable" });
  });
});
