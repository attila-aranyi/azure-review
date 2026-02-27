# Code Review Report

**Project:** azure-review / llm-review-service
**Date:** 2026-02-27
**Reviewer:** Claude Opus 4.6 (Automated Security & Quality Review)
**Scope:** All uncommitted changes — 12 modified files, 30+ new untracked files
**Verdict:** **BLOCK** — 7 CRITICAL, 8 HIGH issues identified. Do not merge until resolved.

---

## Table of Contents

- [Summary](#summary)
- [CRITICAL Issues](#critical-issues)
  - [CRIT-1: JWT Signature Never Verified — Complete Authentication Bypass](#crit-1-jwt-signature-never-verified--complete-authentication-bypass)
  - [CRIT-2: Self-Hosted Mode Accepts Any Bearer Token](#crit-2-self-hosted-mode-accepts-any-bearer-token)
  - [CRIT-3: Live Secrets on Disk in `.env.azure`](#crit-3-live-secrets-on-disk-in-envazure)
  - [CRIT-4: Weak and Inconsistent Encryption Key Derivation](#crit-4-weak-and-inconsistent-encryption-key-derivation)
  - [CRIT-5: Multi-Tenant Webhook Ignores Tenant Context (Non-Queued Path)](#crit-5-multi-tenant-webhook-ignores-tenant-context-non-queued-path)
  - [CRIT-6: Queue Worker Ignores `tenantId` from Job Payload](#crit-6-queue-worker-ignores-tenantid-from-job-payload)
  - [CRIT-7: DELETE `/auth/ado/connection/:tenantId` Has No Authentication](#crit-7-delete-authadoconnectiontenantid-has-no-authentication)
- [HIGH Issues](#high-issues)
  - [HIGH-1: N+1 Query in DB Audit Store](#high-1-n1-query-in-db-audit-store)
  - [HIGH-2: Non-Transactional Multi-Table Insert in Audit Store](#high-2-non-transactional-multi-table-insert-in-audit-store)
  - [HIGH-3: Unsafe Type Cast of `previewUrl` Bypasses Validation](#high-3-unsafe-type-cast-of-previewurl-bypasses-validation)
  - [HIGH-4: `runReview` Function Exceeds 450 Lines](#high-4-runreview-function-exceeds-450-lines)
  - [HIGH-5: Hardcoded Database Credentials in Docker Compose](#high-5-hardcoded-database-credentials-in-docker-compose)
  - [HIGH-6: Unbounded Recursive `getAccessToken` Can Stack Overflow](#high-6-unbounded-recursive-getaccesstoken-can-stack-overflow)
  - [HIGH-7: Missing Pagination Bounds on API Routes](#high-7-missing-pagination-bounds-on-api-routes)
  - [HIGH-8: Mass Assignment in Project Update Repository](#high-8-mass-assignment-in-project-update-repository)
- [MEDIUM Issues](#medium-issues)
  - [MED-1: JWT Without `exp` Claim Accepted Forever](#med-1-jwt-without-exp-claim-accepted-forever)
  - [MED-2: Double Type Cast Bypasses TypeScript Safety](#med-2-double-type-cast-bypasses-typescript-safety)
  - [MED-3: Read-Then-Write Race Condition in Token Store](#med-3-read-then-write-race-condition-in-token-store)
  - [MED-4: Token Refresh Retries Without Backoff](#med-4-token-refresh-retries-without-backoff)
  - [MED-5: `clientSecret` Silently Defaults to Empty String](#med-5-clientsecret-silently-defaults-to-empty-string)
  - [MED-6: In-Memory OAuth State Store — Unbounded and Non-Scalable](#med-6-in-memory-oauth-state-store--unbounded-and-non-scalable)
  - [MED-7: Tenant ID in Redirect URL Without Encoding](#med-7-tenant-id-in-redirect-url-without-encoding)
  - [MED-8: OAuth Callback Uses User Profile ID as Org ID](#med-8-oauth-callback-uses-user-profile-id-as-org-id)
  - [MED-9: Tenant Enumeration via Distinct HTTP Status Codes](#med-9-tenant-enumeration-via-distinct-http-status-codes)
  - [MED-10: Postgres Port Bound to All Interfaces in Docker Compose](#med-10-postgres-port-bound-to-all-interfaces-in-docker-compose)
  - [MED-11: Database Pool Assigned Before Connection Verification](#med-11-database-pool-assigned-before-connection-verification)
  - [MED-12: COUNT(*) with JOIN Executed Per Finding in Idempotency Store](#med-12-count-with-join-executed-per-finding-in-idempotency-store)
  - [MED-13: Duplicate Zod Payload Schema Definitions](#med-13-duplicate-zod-payload-schema-definitions)
  - [MED-14: Token Refresh Error May Leak Sensitive Data](#med-14-token-refresh-error-may-leak-sensitive-data)
  - [MED-15: Unvalidated JSON.parse of External Token Response](#med-15-unvalidated-jsonparse-of-external-token-response)
  - [MED-16: `PLAN_LIMITS` Defined But Never Used in Rate Limiter](#med-16-plan_limits-defined-but-never-used-in-rate-limiter)
  - [MED-17: JWKS Cache Is a Module-Level Mutable Singleton](#med-17-jwks-cache-is-a-module-level-mutable-singleton)
  - [MED-18: Tenant Error Messages Leak Internal State](#med-18-tenant-error-messages-leak-internal-state)
  - [MED-19: `appConfigSchema` Uses `.passthrough()` Allowing Arbitrary Keys](#med-19-appconfigschema-uses-passthrough-allowing-arbitrary-keys)
  - [MED-20: Missing `tenantId` Format Validation on Webhook Path Parameter](#med-20-missing-tenantid-format-validation-on-webhook-path-parameter)
- [LOW Issues](#low-issues)
  - [LOW-1: `console.log` in Migration CLI](#low-1-consolelog-in-migration-cli)
  - [LOW-2: No Rate Limiting on Auth Routes](#low-2-no-rate-limiting-on-auth-routes)
  - [LOW-3: Missing Database Transaction in Project Enable Flow](#low-3-missing-database-transaction-in-project-enable-flow)
  - [LOW-4: Timing Information Leakage in Webhook Secret Loop](#low-4-timing-information-leakage-in-webhook-secret-loop)
  - [LOW-5: Floating Docker Base Image Tag](#low-5-floating-docker-base-image-tag)
  - [LOW-6: Outdated Vitest Version](#low-6-outdated-vitest-version)
  - [LOW-7: `buildLlmConfigFromApp` Returns Hardcoded Mock Providers](#low-7-buildllmconfigfromapp-returns-hardcoded-mock-providers)
  - [LOW-8: Inline `ReviewLimits` Construction Should Use Helper](#low-8-inline-reviewlimits-construction-should-use-helper)
  - [LOW-9: AdoClient Constructor Overloading Is Fragile](#low-9-adoclient-constructor-overloading-is-fragile)
- [Positive Observations](#positive-observations)
- [Security Checklist](#security-checklist)
- [Prioritized Remediation Roadmap](#prioritized-remediation-roadmap)
- [Files Reviewed](#files-reviewed)

---

## Summary

| Severity | Count | Action |
|----------|-------|--------|
| CRITICAL | 7 | Must fix before any deployment |
| HIGH | 8 | Must fix before merge |
| MEDIUM | 20 | Should fix; can merge with tech debt ticket |
| LOW | 9 | Consider improving |
| **Total** | **44** | |

The most severe problems fall into three categories:

1. **Authentication is fundamentally broken** — JWT signatures are never verified (CRIT-1), self-hosted mode accepts any bearer token (CRIT-2), and the DELETE auth endpoint has no auth at all (CRIT-7). The service effectively has no authentication.
2. **Multi-tenant feature is non-functional** — Both the non-queued path (CRIT-5) and the queue worker (CRIT-6) ignore tenant context, meaning all multi-tenant reviews run against the wrong ADO organization with legacy config.
3. **Cryptographic weaknesses** — Encryption key derivation is weak and inconsistent between code paths (CRIT-4), and live secrets exist on disk (CRIT-3).

---

## CRITICAL Issues

### CRIT-1: JWT Signature Never Verified — Complete Authentication Bypass

| Field | Value |
|-------|-------|
| **File** | `src/middleware/adoAuth.ts` |
| **Lines** | 43–48, 103–126 |
| **Category** | Broken Authentication (CWE-347, CWE-345) |
| **OWASP** | A07:2021 – Identification and Authentication Failures |

#### Description

The `decodeJwtPayload()` function only base64-decodes the JWT payload without verifying the cryptographic signature. The `fetchJwks()` function exists (lines 23–41) and correctly fetches public keys from the Azure DevOps JWKS endpoint, but **it is never called anywhere in the authentication flow**.

```typescript
// Lines 43-48 — Only decodes, never verifies
function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT format");
  const payload = Buffer.from(parts[1], "base64url").toString("utf8");
  return JSON.parse(payload) as Record<string, unknown>;
}
```

In SaaS mode (lines 103–126), the middleware trusts whatever claims are in the JWT payload — `aud`, `organizationId`, `sub`, `exp` — without ever checking that the JWT was signed by Azure DevOps.

#### Proof of Concept

```javascript
// Attacker crafts a fake JWT (no valid signature needed)
const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" }));
const payload = btoa(JSON.stringify({
  aud: "target-org-id",
  sub: "attacker",
  exp: Math.floor(Date.now() / 1000) + 3600
}));
const fakeToken = `${header}.${payload}.fakesig`;
// Send: Authorization: Bearer <fakeToken>
// Result: Full access as the target tenant
```

#### Impact

Any attacker can forge a JWT with an arbitrary `aud`/`organizationId` claim and gain **full access as any tenant**. This is a complete authentication bypass.

#### Suggested Fix

Use a proper JWT verification library (`jose`, `jsonwebtoken`, or `fast-jwt`) to validate signatures against the fetched JWKS keys:

```typescript
import * as jose from "jose";

const JWKS = jose.createRemoteJWKSet(
  new URL("https://app.vstoken.visualstudio.com/_apis/Token/SessionTokens...")
);

// In the auth middleware:
const { payload } = await jose.jwtVerify(token, JWKS, {
  // Optionally set expected audience, issuer, etc.
});
```

---

### CRIT-2: Self-Hosted Mode Accepts Any Bearer Token

| Field | Value |
|-------|-------|
| **File** | `src/middleware/adoAuth.ts` |
| **Lines** | 71–95 |
| **Category** | Broken Authentication (CWE-287, CWE-306) |
| **OWASP** | A07:2021 – Identification and Authentication Failures |

#### Description

In self-hosted mode, if a bearer token is provided but is not a parseable JWT (i.e., `decodeJwtPayload` throws), the code falls through to a catch block that silently ignores the error and then assigns the first tenant from the database **with no credential validation whatsoever**:

```typescript
if (appConfig.DEPLOYMENT_MODE === "self-hosted" && scheme.toLowerCase() === "bearer") {
  try {
    const payload = decodeJwtPayload(token);
    // ...
  } catch {
    // Not a JWT, treat as API key   <-- silently ignores
  }

  // For self-hosted with simple API key, find the single tenant
  const allTenants = await db.select().from(tenants).limit(1);
  if (allTenants.length > 0) {
    request.tenantId = allTenants[0].id;   // <-- NO TOKEN VALIDATION
    return;
  }
}
```

Any request with `Authorization: Bearer literally-anything` will pass authentication.

#### Impact

Complete authentication bypass in self-hosted deployments. Any party who knows the server URL can access all API endpoints as the first tenant.

#### Suggested Fix

Validate the bearer token against a configured API key using constant-time comparison:

```typescript
import crypto from "node:crypto";

// After JWT parsing fails in the catch block:
const expectedApiKey = appConfig.SELF_HOSTED_API_KEY;
if (!expectedApiKey) {
  return reply.code(500).send({ error: "No API key configured for self-hosted mode" });
}
const tokenBuf = Buffer.from(token);
const expectedBuf = Buffer.from(expectedApiKey);
if (tokenBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(tokenBuf, expectedBuf)) {
  return reply.code(401).send({ error: "Invalid credentials" });
}
```

---

### CRIT-3: Live Secrets on Disk in `.env.azure`

| Field | Value |
|-------|-------|
| **File** | `llm-review-service/.env.azure` |
| **Category** | Secrets Exposure (CWE-798, CWE-540) |
| **OWASP** | A02:2021 – Cryptographic Failures |

#### Description

The file `.env.azure` contains live, production-grade credentials in plaintext on the filesystem:

- **Azure DevOps PAT:** `8rteO8dCTNmpYdbKWli7dXPP9uILhn0icRue7cvTyG58jVQpZHYhJQQJ99CBAC...`
- **Anthropic API key:** `sk-ant-api03-5doGFM08D1xBYMP9NgeSafsyYoH_sWitONNRDqTFuXRhs0orLrT52QpMFjPtPU...`
- **Webhook secret:** `4cceb19eb303c22538bb0af81ae1143899e3bc1865ea9107740cffdad8b6d6fb`

While the `.gitignore` does exclude this file and it does not appear in git history, anyone with filesystem access to this machine or any backup/snapshot of this project directory obtains full API access.

#### Impact

- Full Azure DevOps organization access via the PAT
- Unlimited Anthropic API usage billed to the key owner
- Ability to forge webhook requests using the webhook secret

#### Suggested Fix

1. **Immediately rotate all three secrets** — treat them as compromised.
2. Move secrets to a proper secrets manager (Azure Key Vault, AWS Secrets Manager, HashiCorp Vault, or at minimum 1Password CLI / `op run`).
3. Add a pre-commit hook (`git-secrets`, `detect-secrets`, or `trufflehog`) to prevent accidental future commits.
4. Consider using `dotenvx` or `sops` for encrypted env files if file-based configuration is necessary.

---

### CRIT-4: Weak and Inconsistent Encryption Key Derivation

| Field | Value |
|-------|-------|
| **Files** | `src/app.ts:57`, `src/server.ts:31` |
| **Category** | Weak Cryptography (CWE-327, CWE-328) |
| **OWASP** | A02:2021 – Cryptographic Failures |

#### Description

The encryption key is derived inconsistently between two code paths:

**In `app.ts` (line 57):**
```typescript
encryptionKey = Buffer.from(args.appConfig.TOKEN_ENCRYPTION_KEY, "utf8").subarray(0, 32);
```

**In `server.ts` (line 31):**
```typescript
const encryptionKey = Buffer.from(appConfig.TOKEN_ENCRYPTION_KEY, "utf8");
```

Problems:
1. **No KDF (Key Derivation Function)** — Raw user-provided strings have low entropy per byte (~6.5 bits vs 8 bits for random bytes).
2. **Inconsistent derivation** — `app.ts` truncates to 32 bytes; `server.ts` does not. If the env var is longer than 32 characters, the two paths produce **different keys**, causing silent decryption failures.
3. **No format validation** — The config schema only requires `min(32)` for string length but does not enforce hex or base64 encoding.

#### Impact

- Tokens encrypted in one code path may not be decryptable in another (key mismatch).
- Reduced effective key strength makes brute-force attacks more feasible.
- If the key string is 33+ characters, the two code paths silently diverge.

#### Suggested Fix

Require a 64-character hex string and centralize derivation:

```typescript
// In appConfig schema:
TOKEN_ENCRYPTION_KEY: z.string()
  .regex(/^[0-9a-fA-F]{64}$/, "Must be a 64-character hex string (32 bytes)")
  .optional(),

// Shared utility:
export function deriveEncryptionKey(hexKey: string): Buffer {
  const key = Buffer.from(hexKey, "hex");
  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return key;
}
```

Use this single function in both `app.ts` and `server.ts`.

---

### CRIT-5: Multi-Tenant Webhook Ignores Tenant Context (Non-Queued Path)

| Field | Value |
|-------|-------|
| **File** | `src/routes/webhooks.ts` |
| **Lines** | 198–209 |
| **Category** | Broken Business Logic |

#### Description

When the queue is disabled, the multi-tenant webhook route calls `runReview` with the **legacy single-tenant config** instead of building a `TenantContext`. The `tenantId` and `adoProjectId` are completely discarded:

```typescript
} else {
  const timeoutMs = 120_000;
  setImmediate(() => {
    void Promise.race([
      runReview({
        config: opts.config,  // <-- legacy config, not tenant-specific
        repoId,
        prId,
        requestId: request.id,
        auditStore: opts.auditStore,  // <-- legacy audit store
        previewUrl
      }),
```

#### Impact

- Reviews authenticate against the wrong ADO organization (legacy config, not the tenant's).
- Review results are not associated with the tenant.
- No tenant-specific LLM configuration is used.
- The audit store used is the legacy file-based one, not the DB-backed per-tenant store.

#### Suggested Fix

Either require the queue for multi-tenant mode, or build tenant context inline:

```typescript
// Option A: Require queue in multi-tenant mode
if (!opts.queue.enabled) {
  app.log.error("Multi-tenant mode requires queue (REDIS_URL)");
  return reply.code(503).send({ ok: false, error: "Queue required for multi-tenant" });
}

// Option B: Build tenant context inline
const tenantContext = await buildTenantContext(tenantId, opts.db!, appConfig, tokenManager);
setImmediate(() => {
  void runReview({
    config: opts.config,
    repoId, prId,
    requestId: request.id,
    context: tenantContext
  }).catch(...);
});
```

---

### CRIT-6: Queue Worker Ignores `tenantId` from Job Payload

| Field | Value |
|-------|-------|
| **File** | `src/review/queue.ts` |
| **Lines** | 40–42 |
| **Category** | Broken Business Logic |

#### Description

The queue worker receives `tenantId` and `adoProjectId` in the job payload (lines 13–14 added them to the enqueue call) but never reads or uses them:

```typescript
async (job) => {
  await runReview({
    config,
    repoId: job.data.repoId,
    prId: job.data.prId,
    requestId: job.data.requestId,
    auditStore,
    previewUrl: job.data.previewUrl
    // tenantId and adoProjectId are in job.data but NEVER used
  });
},
```

#### Impact

All multi-tenant jobs run with the legacy single-tenant config, defeating the entire purpose of the multi-tenant webhook route.

#### Suggested Fix

The worker must detect `tenantId` in the payload and build the appropriate `TenantContext`:

```typescript
async (job) => {
  const { repoId, prId, requestId, previewUrl, tenantId, adoProjectId } = job.data;

  let context: TenantContext | undefined;
  if (tenantId && db && appConfig && tokenManager) {
    context = await buildTenantContext(tenantId, db, appConfig, tokenManager);
  }

  await runReview({ config, repoId, prId, requestId, auditStore, previewUrl, context });
},
```

This requires `createReviewQueue` to accept additional dependencies (`db`, `appConfig`, `tokenManager`).

---

### CRIT-7: DELETE `/auth/ado/connection/:tenantId` Has No Authentication

| Field | Value |
|-------|-------|
| **File** | `src/routes/auth.ts` |
| **Lines** | 119–124 |
| **Category** | Missing Authentication (CWE-306) |
| **OWASP** | A01:2021 – Broken Access Control |

#### Description

The DELETE endpoint is registered outside the `/api` prefix where `adoAuthMiddleware` is applied (see `app.ts` lines 70–74). Any anonymous user can disconnect any tenant by knowing or guessing their tenant UUID:

```typescript
app.delete<{ Params: { tenantId: string } }>(
  "/auth/ado/connection/:tenantId",
  async (request, reply) => {
    const { tenantId } = request.params;
    await tokenManager.revoke(tenantId);  // <-- No auth check
    return reply.send({ ok: true });
  }
);
```

#### Impact

Denial of service — any attacker can revoke any tenant's OAuth tokens, preventing them from using the service.

#### Suggested Fix

Move under the `/api` prefix or add explicit authentication:

```typescript
app.delete<{ Params: { tenantId: string } }>(
  "/auth/ado/connection/:tenantId",
  async (request, reply) => {
    if (!request.tenantId) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    if (request.tenantId !== request.params.tenantId) {
      return reply.code(403).send({ error: "Forbidden" });
    }
    await tokenManager.revoke(request.params.tenantId);
    return reply.send({ ok: true });
  }
);
```

---

## HIGH Issues

### HIGH-1: N+1 Query in DB Audit Store

| Field | Value |
|-------|-------|
| **File** | `src/review/audit.ts` |
| **Lines** | 152–156 |
| **Category** | Performance / Database |

#### Description

For each review row, a separate query fetches findings. With 50 reviews (the default limit), this executes 51 queries:

```typescript
for (const row of rows) {
  const findings = await db
    .select()
    .from(reviewFindings)
    .where(eq(reviewFindings.reviewId, row.id));
  // ...
}
```

#### Suggested Fix

Use a batch query with `inArray`:

```typescript
const reviewIds = rows.map(r => r.id);
const allFindings = await db
  .select()
  .from(reviewFindings)
  .where(inArray(reviewFindings.reviewId, reviewIds));

const findingsByReview = Map.groupBy(allFindings, f => f.reviewId);
```

---

### HIGH-2: Non-Transactional Multi-Table Insert in Audit Store

| Field | Value |
|-------|-------|
| **File** | `src/review/audit.ts` |
| **Lines** | 99–131 |
| **Category** | Data Integrity |

#### Description

The review record and its findings are inserted in two separate queries with no transaction. If the process crashes between the two inserts, the database will contain a review row with no findings.

```typescript
const reviewRow = await db.insert(reviews).values({...}).returning({ id: reviews.id });
const reviewId = reviewRow[0].id;

if (record.findings.length > 0) {
  await db.insert(reviewFindings).values(...);  // <-- separate query, no transaction
}
```

#### Suggested Fix

```typescript
await db.transaction(async (tx) => {
  const reviewRow = await tx.insert(reviews).values({...}).returning({ id: reviews.id });
  const reviewId = reviewRow[0].id;

  if (record.findings.length > 0) {
    await tx.insert(reviewFindings).values(
      record.findings.map((f) => ({ reviewId, ...f })),
    );
  }
});
```

---

### HIGH-3: Unsafe Type Cast of `previewUrl` Bypasses Validation

| Field | Value |
|-------|-------|
| **File** | `src/routes/webhooks.ts` |
| **Lines** | 86, 194 |
| **Category** | Input Validation / URL Injection (CWE-20) |

#### Description

The Zod schema for the webhook payload does not include `previewUrl`, yet it is extracted via an unsafe cast:

```typescript
const previewUrl = (body as Record<string, unknown>).previewUrl as string | undefined;
```

Since `previewUrl` is eventually used in HTTP requests (visual accessibility checker), this is a URL injection risk. The value could be a number, object, or array and it would silently be cast.

#### Suggested Fix

Add `previewUrl` to the Zod schema:

```typescript
const payloadSchema = z.object({
  // ... existing fields ...
  previewUrl: z.string().url().optional(),
}).passthrough();
```

---

### HIGH-4: `runReview` Function Exceeds 450 Lines

| Field | Value |
|-------|-------|
| **File** | `src/review/runReview.ts` |
| **Lines** | 36–490 |
| **Category** | Maintainability |

#### Description

The `runReview` function is approximately 455 lines long, handling: dependency resolution, ADO status posting, PR fetching, diff collection, LLM preprocessing (LLM1), LLM reviewing (LLM2), accessibility checking (LLM3), visual accessibility checking (LLM4), finding deduplication, thread posting, summary generation, and audit record construction.

The new changes added more branching logic (context vs config fallbacks) making it even harder to follow.

#### Suggested Fix

Extract into smaller functions:
- `resolveReviewDependencies(args)` — returns resolved logger, ado, llm clients, limits
- `processHunk(hunk, clients, idempotency, ado)` — handles a single hunk
- `publishFindings(findings, ado, idempotency)` — dedup and post
- `runVisualA11yPhase(llm4, previewUrl, ...)` — visual accessibility

---

### HIGH-5: Hardcoded Database Credentials in Docker Compose

| Field | Value |
|-------|-------|
| **File** | `docker-compose.yml` |
| **Lines** | 8, 27–29 |
| **Category** | Secrets Management (CWE-798) |

#### Description

```yaml
DATABASE_URL: postgresql://llmreview:llmreview@postgres:5432/llmreview
# ...
POSTGRES_USER: llmreview
POSTGRES_PASSWORD: llmreview
```

While docker-compose is typically for local development, this pattern often gets copied to production deployments.

#### Suggested Fix

```yaml
environment:
  DATABASE_URL: postgresql://${POSTGRES_USER:-llmreview}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-llmreview}

postgres:
  environment:
    POSTGRES_USER: ${POSTGRES_USER:-llmreview}
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD required}
    POSTGRES_DB: ${POSTGRES_DB:-llmreview}
```

---

### HIGH-6: Unbounded Recursive `getAccessToken` Can Stack Overflow

| Field | Value |
|-------|-------|
| **File** | `src/auth/tokenManager.ts` |
| **Lines** | 52–72 (specifically 66–69) |
| **Category** | Denial of Service (CWE-674) |

#### Description

When the token is near expiry, `getAccessToken` calls `refreshToken` and then **recursively calls itself**:

```typescript
if (token.expiresAt.getTime() - Date.now() < bufferMs) {
  await this.refreshToken(tenantId, token.refreshTokenEnc);
  return this.getAccessToken(tenantId);  // <-- unbounded recursion
}
```

If the refresh call succeeds but returns a token that is already near expiry (e.g., `expires_in` is very small, or the remote clock is skewed), this creates infinite recursion.

#### Suggested Fix

Read the freshly stored token directly after refresh:

```typescript
if (token.expiresAt.getTime() - Date.now() < bufferMs) {
  await this.refreshToken(tenantId, token.refreshTokenEnc);
  const refreshed = await this.db
    .select().from(tenantOauthTokens)
    .where(eq(tenantOauthTokens.tenantId, tenantId))
    .limit(1);
  if (refreshed.length === 0) {
    throw new Error(`Tokens disappeared after refresh for tenant ${tenantId}`);
  }
  return decrypt(Buffer.from(refreshed[0].accessTokenEnc, "base64"), this.encryptionKey);
}
```

---

### HIGH-7: Missing Pagination Bounds on API Routes

| Field | Value |
|-------|-------|
| **File** | `src/routes/api/reviews.ts` |
| **Lines** | 20–21 |
| **Category** | Denial of Service (CWE-770) |

#### Description

The `page` and `limit` query parameters are parsed via `parseInt()` with no bounds. A client could request `limit=1000000`, causing the database to return an enormous result set. Negative values or `NaN` are also not guarded against.

#### Suggested Fix

```typescript
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  projectId: z.string().uuid().optional(),
});

const parsed = paginationSchema.safeParse(request.query);
if (!parsed.success) {
  return reply.code(400).send({ error: "Invalid query parameters" });
}
```

---

### HIGH-8: Mass Assignment in Project Update Repository

| Field | Value |
|-------|-------|
| **File** | `src/db/repos/projectRepo.ts` |
| **Lines** | 12, 36–40 |
| **Category** | Broken Access Control (CWE-915) |
| **OWASP** | A01:2021 – Broken Access Control |

#### Description

The `update()` method accepts `Partial<NewProjectEnrollment>`, which includes all fields — `id`, `tenantId`, `adoProjectId`. A caller could accidentally or maliciously pass these fields, causing a tenant isolation breach.

#### Suggested Fix

```typescript
export type ProjectUpdateData = Partial<
  Omit<NewProjectEnrollment, "id" | "tenantId" | "adoProjectId" | "createdAt">
>;

update(tenantId: string, projectId: string, data: ProjectUpdateData): Promise<void>;
```

---

## MEDIUM Issues

### MED-1: JWT Without `exp` Claim Accepted Forever

| Field | Value |
|-------|-------|
| **File** | `src/middleware/adoAuth.ts` |
| **Lines** | 107–109 |
| **Category** | Broken Authentication (CWE-613) |

The expiry check skips tokens without an `exp` claim. An attacker-crafted JWT without `exp` will never expire.

```typescript
const exp = payload.exp as number | undefined;
if (exp && exp * 1000 < Date.now()) { ... }
// If exp is undefined, check is skipped entirely
```

**Fix:** Require the `exp` claim: `if (!exp) return reply.code(401).send({ error: "Token missing expiry" });`

---

### MED-2: Double Type Cast Bypasses TypeScript Safety

| Field | Value |
|-------|-------|
| **File** | `src/context/tenantContext.ts` |
| **Line** | 133 |

`as unknown as Config` completely bypasses TypeScript's type system. If the `Config` type changes, this will silently produce runtime errors.

**Fix:** Create a proper adapter function or define a minimal interface.

---

### MED-3: Read-Then-Write Race Condition in Token Store

| Field | Value |
|-------|-------|
| **File** | `src/auth/tokenManager.ts` |
| **Lines** | 29–50 |
| **Category** | Race Condition (CWE-362) |

The `storeTokens` method uses a select-then-conditional-insert/update pattern. Under concurrent requests, both calls could see no existing row and both attempt to insert.

**Fix:** Use `INSERT ... ON CONFLICT DO UPDATE` (upsert) and add a unique constraint on `tenantId` in `tenantOauthTokens`.

---

### MED-4: Token Refresh Retries Without Backoff

| Field | Value |
|-------|-------|
| **File** | `src/auth/tokenManager.ts` |
| **Lines** | 89–97 |

Three retry attempts execute immediately with no delay. If the token endpoint is rate-limiting, rapid retries worsen the situation.

**Fix:** Add exponential backoff: `await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));`

---

### MED-5: `clientSecret` Silently Defaults to Empty String

| Field | Value |
|-------|-------|
| **File** | `src/auth/tokenManager.ts` |
| **Lines** | 125, 128 |

`this.clientSecret ?? ""` silently sends empty strings to the token endpoint, causing a confusing OAuth error from Azure DevOps instead of an early, clear failure.

**Fix:** Throw an explicit error: `if (!this.clientSecret) throw new Error("clientSecret required for token refresh");`

---

### MED-6: In-Memory OAuth State Store — Unbounded and Non-Scalable

| Field | Value |
|-------|-------|
| **File** | `src/routes/auth.ts` |
| **Lines** | 14–22 |
| **Category** | Denial of Service (CWE-770) |

The `stateStore` uses an unbounded in-memory `Map`. Cleanup only runs when `/auth/ado/authorize` is called. An attacker can flood the endpoint to exhaust memory. Additionally, this store does not survive restarts and does not work with multiple instances.

**Fix:** Add a maximum size limit (`MAX_PENDING_STATES = 10_000`), and use Redis for production multi-instance deployments.

---

### MED-7: Tenant ID in Redirect URL Without Encoding

| Field | Value |
|-------|-------|
| **File** | `src/routes/auth.ts` |
| **Line** | 116 |
| **Category** | Open Redirect (CWE-601) |

```typescript
return reply.redirect(appConfig.OAUTH_REDIRECT_URI + "?success=true&tenantId=" + tenant.id);
```

The `tenantId` is appended without `encodeURIComponent`. The internal tenant UUID is also leaked in the URL query string (visible in browser history, proxy logs, and referrer headers).

**Fix:** Use the `URL` constructor: `const url = new URL(appConfig.OAUTH_REDIRECT_URI); url.searchParams.set("tenantId", tenant.id);`

---

### MED-8: OAuth Callback Uses User Profile ID as Org ID

| Field | Value |
|-------|-------|
| **File** | `src/routes/auth.ts` |
| **Lines** | 93–105 |
| **Category** | Broken Business Logic |

The `/auth/ado/callback` fetches the user's personal profile and uses `profile.id` as `orgId`. This is the **user's profile ID**, not the organization ID. Each user gets their own "tenant" rather than sharing an org-level tenant. The fallback to `orgId = "unknown"` (line 99) is also dangerous — multiple users whose profile fails to parse would all merge into a single "unknown" tenant.

**Fix:** Use the Azure DevOps Accounts API to get the actual organization. Never fall through to `orgId = "unknown"`.

---

### MED-9: Tenant Enumeration via Distinct HTTP Status Codes

| Field | Value |
|-------|-------|
| **File** | `src/routes/webhooks.ts` |
| **Lines** | 121–123, 190–191 |

An attacker can distinguish between a non-existent tenant (404) and an existing tenant with a wrong secret (401), enabling enumeration.

**Fix:** Return the same response for both: `if (!tenant || !secretValid) return reply.code(401).send({ ok: false, error: "Unauthorized" });`

---

### MED-10: Postgres Port Bound to All Interfaces in Docker Compose

| Field | Value |
|-------|-------|
| **File** | `docker-compose.yml` |
| **Line** | 25 |

```yaml
ports:
  - "5432:5432"  # binds to 0.0.0.0
```

On machines with a public IP, this exposes the database to the network.

**Fix:** `"127.0.0.1:5432:5432"`

---

### MED-11: Database Pool Assigned Before Connection Verification

| Field | Value |
|-------|-------|
| **File** | `src/db/connection.ts` |
| **Lines** | 19–31 |

If `pool.connect()` fails, the pool object has already been assigned to the module variable. Subsequent calls to `initializeDb()` will return early even though the connection failed.

**Fix:** Assign pool to the module variable only **after** successful verification.

---

### MED-12: COUNT(*) with JOIN Executed Per Finding in Idempotency Store

| Field | Value |
|-------|-------|
| **File** | `src/review/idempotency.ts` |
| **Lines** | 146–153 |

For every single finding, a `COUNT(*)` with a JOIN is executed. In a PR with 50 findings, that is 50 queries. Additionally, `limit(1)` on a `COUNT(*)` is meaningless since COUNT always returns one row.

**Fix:** Use `EXISTS` or pre-fetch all finding hashes for the repo/PR at the start and check in-memory.

---

### MED-13: Duplicate Zod Payload Schema Definitions

| Field | Value |
|-------|-------|
| **File** | `src/routes/webhooks.ts` |
| **Lines** | 49–70, 142–154 |

The webhook payload Zod schema is defined twice — once for the legacy route and once for the multi-tenant route. Any future change must be updated in two places.

**Fix:** Extract into a shared `basePayloadSchema` constant.

---

### MED-14: Token Refresh Error May Leak Sensitive Data

| Field | Value |
|-------|-------|
| **File** | `src/auth/tokenManager.ts` |
| **Line** | 139 |

```typescript
throw new Error(`Token refresh failed: ${res.statusCode} ${text}`);
```

The full response body from the token endpoint may contain sensitive error details, tokens, or internal Azure DevOps information.

**Fix:** Truncate: `const sanitized = text.length > 200 ? text.substring(0, 200) + "...[truncated]" : text;`

---

### MED-15: Unvalidated JSON.parse of External Token Response

| Field | Value |
|-------|-------|
| **File** | `src/auth/tokenManager.ts` |
| **Line** | 142 |

`JSON.parse(text) as OAuthTokenResponse` blindly trusts the shape. Malformed responses could produce corrupt ciphertext stored in the database.

**Fix:** Validate with Zod or manual checks before casting.

---

### MED-16: `PLAN_LIMITS` Defined But Never Used in Rate Limiter

| Field | Value |
|-------|-------|
| **File** | `src/middleware/rateLimiter.ts` |
| **Lines** | 5–9 |

The `PLAN_LIMITS` constant maps plan tiers to rate limits, but the actual rate limiter uses `opts.appConfig.RATE_LIMIT_MAX` as a flat value. Per-plan rate limiting is incomplete.

**Fix:** Integrate plan-based limits into the rate limiter or remove the dead code.

---

### MED-17: JWKS Cache Is a Module-Level Mutable Singleton

| Field | Value |
|-------|-------|
| **File** | `src/middleware/adoAuth.ts` |
| **Lines** | 20–21 |

`let jwksCache` is a module-level mutable variable. This makes it impossible to clear in tests and creates shared state between test cases.

**Fix:** Encapsulate the cache in a class or use dependency-injected cache store.

---

### MED-18: Tenant Error Messages Leak Internal State

| Field | Value |
|-------|-------|
| **File** | `src/context/tenantContext.ts` |
| **Lines** | 59–65 |

Error messages like `Tenant is suspended: ${tenantId}` expose internal tenant IDs and status to the caller.

**Fix:** Use generic messages for external consumption and log details internally.

---

### MED-19: `appConfigSchema` Uses `.passthrough()` Allowing Arbitrary Keys

| Field | Value |
|-------|-------|
| **File** | `src/config/appConfig.ts` |
| **Line** | 80 |

`.passthrough()` means typos in environment variable names (e.g., `DATABSE_URL`) will silently be ignored.

**Fix:** Consider `.strict()` or document why `.passthrough()` is necessary.

---

### MED-20: Missing `tenantId` Format Validation on Webhook Path Parameter

| Field | Value |
|-------|-------|
| **File** | `src/routes/webhooks.ts` |
| **Line** | 117 |

The `tenantId` path parameter is used directly in database queries without format validation.

**Fix:** Add a Zod schema for route params: `z.object({ tenantId: z.string().uuid() })`.

---

## LOW Issues

### LOW-1: `console.log` in Migration CLI

| **File** | `src/db/migrate.ts:21, 25` |
|----------|----------------------------|

CLI entry point uses `console.log`/`console.error`. Acceptable for CLI tools but inconsistent with the rest of the codebase.

---

### LOW-2: No Rate Limiting on Auth Routes

| **File** | `src/routes/auth.ts` |
|----------|----------------------|

OAuth authorize and callback endpoints are not rate-limited. Could be abused for state store exhaustion.

---

### LOW-3: Missing Database Transaction in Project Enable Flow

| **File** | `src/routes/api/projects.ts:40-66` |
|----------|-------------------------------------|

Read-then-write without a transaction. Concurrent requests could cause duplicate enrollments.

---

### LOW-4: Timing Information Leakage in Webhook Secret Loop

| **File** | `src/routes/webhooks.ts:177-188` |
|----------|-----------------------------------|

While individual comparisons use `timingSafeEqual`, the early `break` on match reveals which enrollment index matched.

**Fix:** Iterate all enrollments without breaking.

---

### LOW-5: Floating Docker Base Image Tag

| **File** | `Dockerfile:1, 10` |
|----------|---------------------|

`node:20-slim` is a floating tag. Pin to a specific version for reproducible builds: `node:20.19-slim`.

---

### LOW-6: Outdated Vitest Version

| **File** | `package.json:37` |
|----------|---------------------|

`vitest` is at `^0.34.6` (now at 2.x+). Consider updating in a follow-up.

---

### LOW-7: `buildLlmConfigFromApp` Returns Hardcoded Mock Providers

| **File** | `src/context/tenantContext.ts:123-134` |
|----------|----------------------------------------|

All multi-tenant reviews use mock LLM providers. No ticket reference for the "Phase 2" replacement.

**Fix:** Add a TODO with a ticket reference and log a warning.

---

### LOW-8: Inline `ReviewLimits` Construction Should Use Helper

| **File** | `src/review/runReview.ts:130-131` |
|----------|-----------------------------------|

Inline object construction duplicates the mapping already done by `limitsFromConfig`. Create a matching `limitsFromTenantConfig` in `limits.ts`.

---

### LOW-9: AdoClient Constructor Overloading Is Fragile

| **File** | `src/azure/adoClient.ts:48-77` |
|----------|--------------------------------|

Constructor uses overloads with positional parameters whose meaning changes based on the first argument type.

**Fix:** Use factory functions: `AdoClient.fromConfig(config)` / `AdoClient.fromAuth(auth, orgUrl)`.

---

## Positive Observations

The following practices are well-implemented and should be maintained:

| Area | Details |
|------|---------|
| **Encryption at rest** | AES-256-GCM with random 12-byte IVs, proper auth tag handling, minimum ciphertext length check |
| **No hardcoded secrets in source** | All credentials come from environment variables or database |
| **Structured logging** | Consistent use of pino; no `console.log` in application code |
| **Zod validation** | Config and webhook payload validation with sensible defaults and conditional validation |
| **Rate limiting** | Per-tenant rate limiting on webhook and API routes via `@fastify/rate-limit` |
| **Body size limits** | 1MB `bodyLimit` on webhook routes prevents oversized payload attacks |
| **Database schema** | Foreign key cascading deletes, unique indexes, proper timestamp tracking |
| **Token encryption** | OAuth tokens encrypted before database storage |
| **Repository ID validation** | GUID regex validation on repo IDs prevents injection into API URLs |
| **Timing-safe comparison** | `timingSafeEqual` used for webhook secret comparison with length normalization |
| **Token refresh job** | Well-structured with `interval.unref()`, error handling, and structured logging |
| **Drizzle ORM** | Parameterized queries throughout; SQL injection risk effectively eliminated |
| **Test coverage** | Test files exist for all new modules |

---

## Security Checklist

| Check | Status | Notes |
|-------|--------|-------|
| No hardcoded secrets in source code | PASS | Secrets in .env files, not source |
| No secrets in git history | PASS | .env.azure not in git log |
| Secrets file exists on disk | **FAIL** | .env.azure has live credentials |
| All inputs validated | PASS | Zod schemas used consistently |
| SQL injection prevention | PASS | Drizzle ORM with parameterized queries |
| XSS prevention | PASS/WARN | JSON API, but error reflection concern |
| CSRF protection | PASS | State parameter in OAuth flow |
| Auth required on all routes | **FAIL** | Auth routes and DELETE endpoint unprotected |
| JWT signature verification | **FAIL** | Signatures never verified |
| Authorization verified per-tenant | PASS | tenantId scoping in API routes |
| Rate limiting enabled | PASS | `@fastify/rate-limit` on webhook and API routes |
| HTTPS enforced | N/A | Handled by infrastructure |
| Security headers set | WARN | No explicit headers (CSP, HSTS); consider `@fastify/helmet` |
| Dependencies audit | NOT RUN | Run `npm audit` |
| Logging sanitized | WARN | Token endpoint responses logged verbatim |
| Error messages safe | WARN | Some include raw upstream responses |
| Encryption at rest | PASS | AES-256-GCM for tokens |
| Key derivation | **FAIL** | Raw UTF-8 truncation, no KDF |

---

## Prioritized Remediation Roadmap

### Phase 1: Immediate (Before Any Deployment)

| Priority | Issue | Effort |
|----------|-------|--------|
| P0 | CRIT-1: Implement JWT signature verification | Medium |
| P0 | CRIT-2: Add API key validation in self-hosted mode | Small |
| P0 | CRIT-3: Rotate all leaked secrets | Small |
| P0 | CRIT-4: Fix encryption key derivation and centralize | Small |
| P0 | CRIT-7: Add authentication to DELETE endpoint | Small |

### Phase 2: Before Merge

| Priority | Issue | Effort |
|----------|-------|--------|
| P1 | CRIT-5 + CRIT-6: Wire tenant context through queue worker and non-queued path | Medium |
| P1 | HIGH-3: Add `previewUrl` to Zod schema | Small |
| P1 | HIGH-6: Fix recursive `getAccessToken` | Small |
| P1 | HIGH-7: Add pagination bounds with Zod | Small |
| P1 | HIGH-8: Define specific update type for project repo | Small |
| P1 | MED-1: Require `exp` claim in JWT | Small |
| P1 | MED-8: Fix org ID resolution in OAuth callback | Medium |

### Phase 3: Follow-Up Sprint

| Priority | Issue | Effort |
|----------|-------|--------|
| P2 | HIGH-1: Fix N+1 query in audit store | Small |
| P2 | HIGH-2: Add transaction to audit inserts | Small |
| P2 | HIGH-4: Refactor `runReview` into smaller functions | Large |
| P2 | HIGH-5: Parameterize docker-compose credentials | Small |
| P2 | MED-3: Convert token store to upsert | Small |
| P2 | MED-6: Redis-backed OAuth state store | Medium |
| P2 | MED-9: Normalize error codes to prevent enumeration | Small |
| P2 | MED-12: Optimize idempotency store queries | Medium |

### Phase 4: Ongoing Improvements

| Priority | Issue | Effort |
|----------|-------|--------|
| P3 | Add pre-commit secret scanning hooks | Small |
| P3 | Add `@fastify/helmet` for security headers | Small |
| P3 | Run `npm audit` in CI pipeline | Small |
| P3 | Update vitest to 2.x | Medium |
| P3 | Address remaining LOW issues | Various |

---

## Files Reviewed

### Modified Files (12)

| File | Issues Found |
|------|-------------|
| `src/app.ts` | CRIT-4 |
| `src/server.ts` | CRIT-4 |
| `src/azure/adoClient.ts` | LOW-9 |
| `src/review/audit.ts` | HIGH-1, HIGH-2 |
| `src/review/idempotency.ts` | MED-12 |
| `src/review/queue.ts` | CRIT-6 |
| `src/review/runReview.ts` | HIGH-4, LOW-8 |
| `src/routes/webhooks.ts` | CRIT-5, HIGH-3, MED-9, MED-13, MED-20, LOW-4 |
| `Dockerfile` | LOW-5 |
| `docker-compose.yml` | HIGH-5, MED-10 |
| `package.json` | LOW-6 |
| `package-lock.json` | (dependency changes) |

### New Files (30+)

| File | Issues Found |
|------|-------------|
| `src/auth/encryption.ts` | (well-implemented) |
| `src/auth/tokenManager.ts` | HIGH-6, MED-3, MED-4, MED-5, MED-14, MED-15 |
| `src/config/appConfig.ts` | MED-19 |
| `src/config/tenantConfig.ts` | (clean) |
| `src/context/tenantContext.ts` | MED-2, MED-18, LOW-7 |
| `src/db/connection.ts` | MED-11 |
| `src/db/migrate.ts` | LOW-1 |
| `src/db/repos/configRepo.ts` | (clean) |
| `src/db/repos/projectRepo.ts` | HIGH-8 |
| `src/db/repos/reviewRepo.ts` | (clean) |
| `src/db/repos/tenantRepo.ts` | (clean) |
| `src/db/schema.ts` | (clean) |
| `src/jobs/tokenRefresh.ts` | (well-structured) |
| `src/middleware/adoAuth.ts` | CRIT-1, CRIT-2, MED-1, MED-17 |
| `src/middleware/rateLimiter.ts` | MED-16 |
| `src/routes/api/config.ts` | (clean) |
| `src/routes/api/index.ts` | (clean) |
| `src/routes/api/projects.ts` | (clean) |
| `src/routes/api/reviews.ts` | HIGH-7 |
| `src/routes/api/tenants.ts` | (clean) |
| `src/routes/auth.ts` | CRIT-7, MED-6, MED-7, MED-8, LOW-2 |
| `drizzle.config.ts` | (clean) |
| `.env.azure` | CRIT-3 |
| `test/**` | (not reviewed for issues) |

---

*Generated by Claude Opus 4.6 automated code review. This report should be used as guidance — verify findings against the actual codebase before making changes.*
