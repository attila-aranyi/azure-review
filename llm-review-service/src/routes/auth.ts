import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { request as httpRequest } from "undici";
import type { AppConfig } from "../config/appConfig";
import type { DrizzleInstance } from "../db/connection";
import type { TokenManager, OAuthTokenResponse } from "../auth/tokenManager";
import { createTenantRepo } from "../db/repos/tenantRepo";
import { adoAuthMiddleware } from "../middleware/adoAuth";

const ADO_AUTHORIZE_URL = "https://app.vssps.visualstudio.com/oauth2/authorize";
const ADO_TOKEN_URL = "https://app.vssps.visualstudio.com/oauth2/token";
const ADO_SCOPES = "vso.code_write vso.hooks_write vso.project";

const MAX_PENDING_STATES = 10_000;

// In-memory state store for CSRF protection (use Redis in production)
const stateStore = new Map<string, { createdAt: number }>();
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function cleanupStates() {
  const cutoff = Date.now() - STATE_TTL_MS;
  for (const [key, value] of stateStore) {
    if (value.createdAt < cutoff) stateStore.delete(key);
  }
}

export const registerAuthRoutes: FastifyPluginAsync<{
  appConfig: AppConfig;
  db: DrizzleInstance;
  tokenManager: TokenManager;
}> = async (app, opts) => {
  const { appConfig, db, tokenManager } = opts;
  const tenantRepo = createTenantRepo(db);

  // GET /auth/ado/authorize
  app.get("/auth/ado/authorize", async (request, reply) => {
    cleanupStates();

    // Enforce max pending states (MED-6)
    if (stateStore.size >= MAX_PENDING_STATES) {
      return reply.code(503).send({ error: "Too many pending authorization requests" });
    }

    const state = crypto.randomUUID();
    stateStore.set(state, { createdAt: Date.now() });

    const params = new URLSearchParams({
      client_id: appConfig.OAUTH_CLIENT_ID!,
      response_type: "Assertion",
      state,
      scope: ADO_SCOPES,
      redirect_uri: appConfig.OAUTH_REDIRECT_URI!,
    });

    return reply.redirect(`${ADO_AUTHORIZE_URL}?${params.toString()}`);
  });

  // GET /auth/ado/callback
  app.get<{
    Querystring: { code?: string; state?: string; error?: string };
  }>("/auth/ado/callback", async (request, reply) => {
    const { code, state, error } = request.query;

    if (error) {
      return reply.code(400).send({ error: `OAuth error: ${error}` });
    }

    if (!state || !stateStore.has(state)) {
      return reply.code(400).send({ error: "Invalid or expired state parameter" });
    }
    stateStore.delete(state);

    if (!code) {
      return reply.code(400).send({ error: "Missing authorization code" });
    }

    // Exchange code for tokens
    const body = new URLSearchParams({
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: appConfig.OAUTH_CLIENT_SECRET!,
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: code,
      redirect_uri: appConfig.OAUTH_REDIRECT_URI!,
    });

    const tokenRes = await httpRequest(ADO_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const tokenText = await tokenRes.body.text();
    if (tokenRes.statusCode !== 200) {
      app.log.error({ statusCode: tokenRes.statusCode }, "Token exchange failed");
      return reply.code(400).send({ error: "Token exchange failed" });
    }

    const tokens = JSON.parse(tokenText) as OAuthTokenResponse;

    // Get organization info using the Accounts API (MED-8: not user profile ID)
    let orgId: string | undefined;
    try {
      const accountsRes = await httpRequest(
        "https://app.vssps.visualstudio.com/_apis/accounts?api-version=6.0",
        {
          method: "GET",
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        },
      );
      const accountsText = await accountsRes.body.text();
      if (accountsRes.statusCode === 200) {
        const accounts = JSON.parse(accountsText) as { value?: Array<{ accountId?: string; accountName?: string }> };
        if (accounts.value && accounts.value.length > 0) {
          orgId = accounts.value[0].accountId;
        }
      }
    } catch {
      // Fall through to error
    }

    if (!orgId) {
      app.log.error("Failed to resolve organization ID from ADO Accounts API");
      return reply.code(400).send({ error: "Could not determine organization. Please try again." });
    }

    // Upsert tenant
    const tenant = await tenantRepo.upsert({
      adoOrgId: orgId,
      status: "active",
    });

    // Store tokens
    await tokenManager.storeTokens(tenant.id, tokens);

    // MED-7: Use URL constructor for safe redirect
    const redirectUrl = new URL(appConfig.OAUTH_REDIRECT_URI!);
    redirectUrl.searchParams.set("success", "true");
    redirectUrl.searchParams.set("tenantId", tenant.id);
    return reply.redirect(redirectUrl.toString());
  });

  // DELETE /auth/ado/connection/:tenantId — requires authentication (CRIT-7)
  await app.register(async (authScope) => {
    await authScope.register(adoAuthMiddleware, { appConfig, db });

    authScope.delete<{ Params: { tenantId: string } }>("/auth/ado/connection/:tenantId", async (request, reply) => {
      if (!request.tenantId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const { tenantId } = request.params;
      // Prevent disconnecting a different tenant
      if (request.tenantId !== tenantId) {
        return reply.code(403).send({ error: "Forbidden" });
      }
      await tokenManager.revoke(tenantId);
      return reply.send({ ok: true });
    });
  });
};
