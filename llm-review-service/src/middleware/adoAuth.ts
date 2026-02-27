import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import * as jose from "jose";
import type { AppConfig } from "../config/appConfig";
import type { DrizzleInstance } from "../db/connection";
import { createTenantRepo } from "../db/repos/tenantRepo";
import { tenants } from "../db/schema";

declare module "fastify" {
  interface FastifyRequest {
    tenantId?: string;
    adoUserId?: string;
  }
}

const ADO_JWKS_URL = "https://app.vstoken.visualstudio.com/_apis/Token/SessionTokens?api-version=1.0&clientId=00000000-0000-0000-0000-000000000000";

type KeySetFunction = ReturnType<typeof jose.createRemoteJWKSet>;

export class JwksCache {
  private jwks: KeySetFunction | null = null;

  getKeySet(): KeySetFunction {
    if (!this.jwks) {
      this.jwks = jose.createRemoteJWKSet(new URL(ADO_JWKS_URL));
    }
    return this.jwks;
  }

  clear(): void {
    this.jwks = null;
  }
}

export const adoAuthMiddleware: FastifyPluginAsync<{
  appConfig: AppConfig;
  db: DrizzleInstance;
  jwksCache?: JwksCache;
}> = async (app, opts) => {
  const { appConfig, db } = opts;
  const tenantRepo = createTenantRepo(db);
  const jwksCache = opts.jwksCache ?? new JwksCache();

  app.decorateRequest("tenantId", undefined);
  app.decorateRequest("adoUserId", undefined);

  app.addHook("onRequest", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      return reply.code(401).send({ error: "Missing Authorization header" });
    }

    const spaceIdx = authHeader.indexOf(" ");
    if (spaceIdx < 0) {
      return reply.code(401).send({ error: "Invalid Authorization header" });
    }
    const scheme = authHeader.slice(0, spaceIdx);
    const token = authHeader.slice(spaceIdx + 1);

    if (!scheme || !token) {
      return reply.code(401).send({ error: "Invalid Authorization header" });
    }

    if (scheme.toLowerCase() !== "bearer") {
      return reply.code(401).send({ error: "Expected Bearer authentication" });
    }

    // Self-hosted mode: validate against configured API key
    if (appConfig.DEPLOYMENT_MODE === "self-hosted") {
      const expectedApiKey = appConfig.ADO_PAT;
      if (!expectedApiKey) {
        return reply.code(500).send({ error: "No API key configured for self-hosted mode" });
      }

      const tokenBuf = Buffer.from(token);
      const expectedBuf = Buffer.from(expectedApiKey);
      const isValid = tokenBuf.length === expectedBuf.length && crypto.timingSafeEqual(tokenBuf, expectedBuf);

      if (!isValid) {
        // Try JWT as well (for ADO extension use case)
        try {
          const keySet = jwksCache.getKeySet();
          const { payload } = await jose.jwtVerify(token, keySet);
          const orgId = (payload.aud as string) ?? (payload as Record<string, unknown>).organizationId as string;
          if (orgId) {
            const tenant = await tenantRepo.findByAdoOrgId(orgId);
            if (tenant) {
              request.tenantId = tenant.id;
              request.adoUserId = payload.sub;
              return;
            }
          }
        } catch {
          // JWT verification failed, fall through
        }
        return reply.code(401).send({ error: "Invalid credentials" });
      }

      // API key matched — find the single tenant
      const allTenants = await db.select().from(tenants).limit(1);
      if (allTenants.length > 0) {
        request.tenantId = allTenants[0].id;
        return;
      }
      return reply.code(401).send({ error: "No tenant configured" });
    }

    // SaaS mode: verify JWT signature against ADO JWKS
    try {
      const keySet = jwksCache.getKeySet();
      const { payload } = await jose.jwtVerify(token, keySet);

      // Require exp claim (MED-1)
      if (!payload.exp) {
        return reply.code(401).send({ error: "Token missing expiry" });
      }

      const orgId = (payload.aud as string) ?? (payload as Record<string, unknown>).organizationId as string;
      if (!orgId) {
        return reply.code(401).send({ error: "Missing organization ID in token" });
      }

      const tenant = await tenantRepo.findByAdoOrgId(orgId);
      if (!tenant) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      request.tenantId = tenant.id;
      request.adoUserId = payload.sub;
    } catch (err) {
      if (err instanceof jose.errors.JWTExpired) {
        return reply.code(401).send({ error: "Token expired" });
      }
      return reply.code(401).send({ error: "Invalid token" });
    }
  });
};
