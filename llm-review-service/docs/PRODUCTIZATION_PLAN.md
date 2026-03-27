# Productization Plan: Azure DevOps LLM Code Review

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Analysis](#2-current-state-analysis)
3. [Target Architecture](#3-target-architecture)
4. [Phase 1: MVP (Weeks 1-6)](#4-phase-1-mvp-weeks-1-6)
5. [Phase 2: Growth (Weeks 7-12)](#5-phase-2-growth-weeks-7-12)
6. [Phase 3: Enterprise (Weeks 13-20)](#6-phase-3-enterprise-weeks-13-20)
7. [Database Schema](#7-database-schema)
8. [OAuth 2.0 Implementation](#8-oauth-20-implementation)
9. [Azure DevOps Marketplace Extension](#9-azure-devops-marketplace-extension)
10. [LLM Proxy Layer](#10-llm-proxy-layer)
11. [Self-Hosted Distribution](#11-self-hosted-distribution)
12. [Management API Surface](#12-management-api-surface)
13. [Security Considerations](#13-security-considerations)
14. [New & Modified Files](#14-new--modified-files)
15. [Risks & Mitigations](#15-risks--mitigations)
16. [Key Architectural Decisions](#16-key-architectural-decisions)
17. [Success Criteria](#17-success-criteria)

---

## 1. Executive Summary

This plan transforms the single-tenant, manually-configured Azure DevOps LLM Code Review service into a multi-tenant SaaS product with an Azure DevOps Marketplace extension as the primary onboarding experience. It also defines a self-hosted distribution path for enterprise customers.

### Product Vision

**Before (today):** To set up AI code review, a team must create a bot account, manually generate PATs, deploy infrastructure, configure ~30 environment variables, and manually set up webhooks per project. This takes hours and requires DevOps expertise.

**After (product):** A team admin installs the extension from the Azure DevOps Marketplace with one click, authorizes via OAuth, toggles on their projects, and PR reviews start flowing automatically. Total time: under 5 minutes.

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Hosting | SaaS + self-hosted | SaaS for easy onboarding; self-hosted for enterprise compliance |
| Onboarding UX | Azure DevOps Marketplace Extension | Lowest friction; 1-click install from within ADO |
| Platform scope | Azure DevOps only (for now) | Focus; can add GitHub/GitLab later |
| LLM strategy | Managed LLM default + BYOK option | Simple onboarding by default; flexibility for enterprise |

---

## 2. Current State Analysis

### Current Architecture

```
Azure DevOps PR
      | (manual webhook setup)
      v
POST /webhooks/azure-devops/pr
      | (validates x-webhook-secret header)
      v
Queue (BullMQ/Redis) or sync
      |
      v
runReview.ts Pipeline:
  1. Fetch PR metadata (ADO API with PAT)
  2. Collect diffs (diff library)
  3. Per hunk:
     - LLM1: Context Preprocessor
     - LLM2: Code Reviewer
     - LLM3: Accessibility Checker (optional)
  4. LLM4: Visual Accessibility (optional, Playwright)
  5. Filter by severity
  6. Dedup via idempotency store
  7. Post findings as PR comments
  8. Post summary thread
```

### Current Pain Points for Multi-Tenant Use

| Component | Current State | Problem |
|-----------|--------------|---------|
| `src/config.ts` | Single Zod schema, ~30 env vars, one `ADO_ORG`/`ADO_PROJECT`/`ADO_PAT` | Hard-coded single tenant; every config is a process-level singleton |
| `src/azure/adoClient.ts` | Constructs REST calls using single PAT from config | Cannot serve multiple orgs; PAT is baked in |
| `src/routes/webhooks.ts` | Receives webhook, extracts PR info, enqueues job | No tenant identification on incoming webhooks |
| `src/review/runReview.ts` | Orchestrates 4 LLM stages, reads provider config from env | LLM config is global, not per-tenant |
| `src/review/queue.ts` | BullMQ queue with Redis | Jobs carry no tenant context |
| `src/review/audit.ts` | Appends to `.data/audit.jsonl` file | File-based, no multi-tenant isolation, no queryability |
| `src/review/idempotency.ts` | JSON file for dedup | File-based, no tenant scoping, won't survive container restarts |

### Key Insight

The core review pipeline (`runReview.ts` + LLM stages) is largely **tenant-agnostic** -- it takes a diff and produces findings. The tenant coupling is only in:

1. **How we authenticate to ADO** (PAT vs OAuth)
2. **How we receive/validate webhooks** (shared secret)
3. **How we store config/state** (env vars, files)
4. **How we select LLM providers** (env vars)

This means we can **wrap the existing pipeline with a multi-tenant context layer** without rewriting the review logic itself.

---

## 3. Target Architecture

```
                    Azure DevOps Marketplace
                           |
                    ┌──────┴──────┐
                    | ADO Extension|
                    | - Org Hub    |
                    | - Proj Hub   |
                    | - PR Tab     |
                    └──────┬──────┘
                           |
                    OAuth 2.0 Flow
                           |
    ┌──────────────────────┼──────────────────────────────┐
    |                 SaaS Backend                         |
    |                                                      |
    |  ┌─────────────┐  ┌────────────┐  ┌──────────────┐ |
    |  | Auth &       |  | Management |  | Webhook      | |
    |  | OAuth Routes |  | API        |  | Receiver     | |
    |  | /auth/ado/*  |  | /api/*     |  | /webhooks/   | |
    |  |              |  | (ADO JWT)  |  | ado/:tenantId| |
    |  └──────┬──────┘  └─────┬──────┘  └──────┬───────┘ |
    |         |                |                |          |
    |         v                v                v          |
    |  ┌─────────────────────────────────────────────┐    |
    |  |           Tenant Context Layer               |    |
    |  |  - Resolve tenant from ID/JWT                |    |
    |  |  - Load config (tenant + repo overrides)     |    |
    |  |  - Get OAuth token (auto-refresh)            |    |
    |  |  - Build ADO client with tenant credentials  |    |
    |  └────────────────────┬────────────────────────┘    |
    |                       v                              |
    |  ┌─────────────────────────────────────────────┐    |
    |  |       Existing Review Pipeline               |    |
    |  |  LLM1 -> LLM2 -> LLM3 -> LLM4              |    |
    |  |  (unchanged core logic)                      |    |
    |  └────────────────────┬────────────────────────┘    |
    |                       v                              |
    |  ┌────────────┐ ┌──────────┐ ┌─────────────────┐   |
    |  | PostgreSQL | | Redis/   | | LLM Router      |   |
    |  | - tenants  | | BullMQ   | | - Managed keys  |   |
    |  | - configs  | | - queue  | | - BYOK keys     |   |
    |  | - audit    | |          | | - Usage metering |   |
    |  | - usage    | |          | |                  |   |
    |  └────────────┘ └──────────┘ └─────────────────┘   |
    └──────────────────────────────────────────────────────┘
```

### Tenant Model

```
Tenant = one Azure DevOps Organization
  |- has one OAuth connection (access_token + refresh_token)
  |- has N ProjectEnrollments (one per enabled project)
  |    |- has one service hook subscription (auto-configured)
  |- has one TenantConfig (org-wide defaults)
  |- has N RepoConfigs (optional per-repo overrides)
  |- has one Subscription (billing plan)
  |- has usage records (LLM tokens consumed, reviews performed)
```

**Why org = tenant:** Extensions install at the org level. OAuth tokens are per-org. Billing is per-org. This is the natural boundary.

### Tenant Resolution on Incoming Requests

| Request Type | How Tenant is Identified |
|-------------|-------------------------|
| Webhook from ADO | `tenantId` in URL path (`/webhooks/ado/:tenantId`) + Basic Auth validation |
| API call from Extension Hub | ADO JWT token -> extract `organizationId` from claims |
| OAuth callback | `state` parameter carries org identifier |

---

## 4. Phase 1: MVP (Weeks 1-6)

**Goal:** Any ADO org can install the extension, authorize via OAuth, enable projects, and get LLM reviews on PRs -- with zero manual configuration.

**Boundary:** Single managed LLM (e.g., Anthropic Claude Sonnet for all stages), no BYOK, no per-repo config overrides, no self-hosted, no billing enforcement (soft limits only).

---

### 4.1 Database Foundation (Week 1)

**Objective:** Replace file-based storage with PostgreSQL; establish multi-tenant data model.

#### Tasks

| # | Task | Files | Complexity |
|---|------|-------|-----------|
| 1 | Add PostgreSQL dependencies (`pg`, `drizzle-orm`, `drizzle-kit`) | `package.json` | Low |
| 2 | Create database connection module with pool management | `src/db/connection.ts` (new) | Low |
| 3 | Create migration runner | `src/db/migrate.ts` (new) | Medium |
| 4 | Write initial migration: core tables (see [Schema](#7-database-schema)) | `src/db/migrations/001_initial.sql` (new) | Medium |
| 5 | Create repository layer (data access objects) | `src/db/repos/tenantRepo.ts` (new) | Medium |
| | | `src/db/repos/projectRepo.ts` (new) | |
| | | `src/db/repos/reviewRepo.ts` (new) | |
| 6 | Add `DATABASE_URL` to app config schema | `src/config/appConfig.ts` (from split) | Low |
| 7 | Migrate audit from file to DB | `src/review/audit.ts` (modify) | Low |
| 8 | Migrate idempotency from file to DB | `src/review/idempotency.ts` (modify) | Low |
| 9 | Update docker-compose with Postgres service | `docker-compose.yml` (modify) | Low |

**Dependencies:** 2 -> 3 -> 4 -> 5 -> 7, 8

---

### 4.2 Config Refactor (Week 1-2)

**Objective:** Separate deployment-level config (env vars) from tenant-level config (database).

#### Current `src/config.ts` Splits Into:

**`src/config/appConfig.ts`** -- Infrastructure config (still from env vars):
```typescript
// Deployment-level settings, same for all tenants
const AppConfig = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().optional(),
  OAUTH_CLIENT_ID: z.string(),
  OAUTH_CLIENT_SECRET: z.string(),
  OAUTH_REDIRECT_URI: z.string(),
  TOKEN_ENCRYPTION_KEY: z.string().min(32),
  CORS_ORIGINS: z.string().default(''),
  LOG_LEVEL: z.enum(['trace','debug','info','warn','error','fatal']).default('info'),
  // Managed LLM keys (for SaaS mode)
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  DEPLOYMENT_MODE: z.enum(['saas', 'self-hosted']).default('saas'),
});
```

**`src/config/tenantConfig.ts`** -- Per-tenant config types (loaded from DB):
```typescript
interface TenantConfig {
  llmMode: 'managed' | 'byok';
  llmProvider?: string;         // for BYOK
  llmApiKeyEnc?: Buffer;        // encrypted BYOK key
  llmEndpoint?: string;         // custom endpoint
  llmModelReview: string;
  llmModelA11y: string;
  reviewStrictness: 'relaxed' | 'balanced' | 'strict';
  maxFiles: number;
  maxDiffSize: number;
  fileIncludeGlob?: string;
  fileExcludeGlob?: string;
  enableA11yText: boolean;
  enableA11yVisual: boolean;
  enableSecurity: boolean;
  commentStyle: 'inline' | 'summary' | 'both';
  minSeverity: string;
}
```

**`src/context/tenantContext.ts`** -- Bundles everything the pipeline needs:
```typescript
interface TenantContext {
  tenantId: string;
  orgUrl: string;
  config: EffectiveReviewConfig;  // merged tenant + repo config
  adoClient: AdoClient;           // authenticated for this tenant
  llmClients: LlmClientSet;       // configured for this tenant
  logger: Logger;                  // tagged with tenantId
}
```

#### Key Refactors

| File | Change |
|------|--------|
| `src/azure/adoClient.ts` | Accept auth at construction: `{ type: 'oauth', accessToken }` or `{ type: 'pat', token }` |
| `src/review/runReview.ts` | Accept `TenantContext` instead of reading global config |
| `src/review/queue.ts` | Add `tenantId` to job data; worker hydrates TenantContext before running review |
| LLM stage files (`preprocessor.ts`, `reviewer.ts`, etc.) | Receive provider config from context, not globals |

---

### 4.3 OAuth 2.0 Implementation (Week 2-3)

**Objective:** Replace manual PAT creation with OAuth. Users authorize via the extension; tokens are managed automatically.

#### ADO OAuth Flow

```
1. User clicks "Connect" in Extension Org Settings Hub
2. Extension redirects to:
   https://app.vssps.visualstudio.com/oauth2/authorize
     ?client_id={APP_ID}
     &response_type=Assertion
     &state={orgId}
     &scope=vso.code_write vso.code_status vso.hooks_write vso.project vso.profile
     &redirect_uri={CALLBACK_URL}

3. User authorizes -> ADO redirects to callback with authorization code

4. Backend exchanges code for tokens:
   POST https://app.vssps.visualstudio.com/oauth2/token
   grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer
   &assertion={code}
   &client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer
   &client_assertion={client_secret}
   &redirect_uri={CALLBACK_URL}

5. Tokens stored encrypted in DB. Access token expires in 1 hour.
   Refresh token is longer-lived.

6. Background job refreshes all tokens every 45 minutes.
```

#### Required OAuth Scopes

| Scope | Purpose |
|-------|---------|
| `vso.code` | Read source code and diffs |
| `vso.code_write` | Post PR comments (thread creation) |
| `vso.code_status` | Post PR statuses (check results) |
| `vso.hooks_write` | Create/manage service hook subscriptions |
| `vso.project` | List projects in the org |
| `vso.profile` | Read installing user's profile |

#### New Files

**`src/auth/encryption.ts`** -- AES-256-GCM encrypt/decrypt:
```typescript
function encrypt(plaintext: string, key: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]); // iv(12) + tag(16) + ciphertext
}

function decrypt(data: Buffer, key: Buffer): string {
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const ciphertext = data.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}
```

**`src/auth/tokenManager.ts`** -- Token lifecycle:
```typescript
class TokenManager {
  constructor(private db: Database, private encryptionKey: Buffer) {}

  async storeTokens(tenantId: string, tokens: OAuthTokenResponse): Promise<void>;
  async getAccessToken(tenantId: string): Promise<string>;  // auto-refreshes if needed
  async refreshAllExpiring(): Promise<void>;  // called by background job
  async revoke(tenantId: string): Promise<void>;
}
```

**`src/routes/auth.ts`** -- OAuth routes:
```
GET  /auth/ado/authorize    -- Initiates OAuth flow (redirect to ADO)
GET  /auth/ado/callback     -- Receives auth code, exchanges for tokens, creates tenant
DELETE /auth/ado/connection  -- Revoke connection (user-initiated)
```

**`src/middleware/adoAuth.ts`** -- Validates ADO extension JWTs:
```typescript
// Extension hub calls send a JWT from SDK.getAccessToken()
// Middleware validates: signature (JWKS), aud, iss, exp
// Extracts: organizationId, userId -> resolves tenant
```

**`src/jobs/tokenRefresh.ts`** -- Background refresh:
```typescript
// Runs every 45 minutes
// Queries tokens expiring in next 15 minutes
// Refreshes each, updates DB
// On failure: marks tenant as 'needs_reauth', stops processing their webhooks
```

**`src/azure/adoClientFactory.ts`** -- Factory with auto-refresh:
```typescript
async function getAdoClientForTenant(tenantId: string): Promise<AdoClient> {
  const accessToken = await tokenManager.getAccessToken(tenantId); // handles refresh
  return new AdoClient({ type: 'oauth', accessToken }, orgUrl);
}
```

---

### 4.4 Multi-Tenant Webhook Handling (Week 3)

**Objective:** Route incoming webhooks to the correct tenant and validate authenticity.

#### Changes to `src/routes/webhooks.ts`

```typescript
// Route: POST /webhooks/ado/:tenantId
fastify.post('/webhooks/ado/:tenantId', async (request, reply) => {
  const { tenantId } = request.params;

  // 1. Look up tenant
  const tenant = await tenantRepo.findById(tenantId);
  if (!tenant || tenant.status !== 'active') {
    return reply.code(404).send({ error: 'Tenant not found' });
  }

  // 2. Validate Basic Auth (webhook secret set when subscription was created)
  const enrollment = await projectRepo.findByTenantAndProject(tenantId, projectId);
  const webhookSecret = decrypt(enrollment.webhookSecretEnc, encryptionKey);
  if (!validateBasicAuth(request, tenantId, webhookSecret)) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }

  // 3. Verify org ID in payload matches tenant
  const payloadOrgId = extractOrgId(request.body);
  if (payloadOrgId !== tenant.adoOrgId) {
    return reply.code(403).send({ error: 'Org mismatch' });
  }

  // 4. Enqueue with tenant context
  await queue.add('review', {
    tenantId,
    orgUrl: tenant.orgUrl,
    projectId: extractProjectId(request.body),
    repositoryId: extractRepoId(request.body),
    pullRequestId: extractPrId(request.body),
    ...existingPayloadFields,
  });

  return reply.code(202).send({ accepted: true });
});
```

#### Per-Tenant Rate Limiting

```typescript
// New middleware: src/middleware/rateLimiter.ts
// Rate limit per tenantId (not per IP)
// Free plan: 10 webhooks/minute
// Pro plan: 60 webhooks/minute
// Enterprise: 200 webhooks/minute
```

---

### 4.5 Management API (Week 3-4)

**Objective:** Provide API endpoints for the extension UI to manage tenants, projects, and configuration.

#### New Route Group: `src/routes/api/`

All endpoints authenticated via ADO JWT middleware (extracts tenant from token).

**Tenant Info:**
```
GET /api/tenants/me
  Response: { id, orgName, status, plan, connectedAt, config: {...} }

GET /api/tenants/me/status
  Response: { connected: true, tokenValid: true, webhooksActive: 3 }
```

**Configuration:**
```
GET /api/config
  Response: { strictness, maxFiles, enableA11y, ... }

PUT /api/config
  Body: { strictness: 'strict', maxFiles: 30 }
  Response: { updated: true }
```

**Project Management:**
```
GET /api/projects
  Response: [ { id, name, enrolled: true/false }, ... ]
  // Fetches from ADO API, merges with enrollment status

POST /api/projects/:projectId/enable
  // 1. Generate unique webhook secret
  // 2. Create ADO service hook subscription programmatically
  // 3. Store enrollment + subscription ID in DB
  Response: { enrolled: true, webhookSubscriptionId: '...' }

POST /api/projects/:projectId/disable
  // 1. Delete ADO service hook subscription
  // 2. Deactivate enrollment in DB
  Response: { enrolled: false }
```

**Service Hook Auto-Configuration** (the key onboarding automation):
```typescript
async function enableProject(tenantId: string, projectId: string) {
  const adoClient = await getAdoClientForTenant(tenantId);
  const webhookSecret = crypto.randomBytes(32).toString('hex');

  // Create service hook for PR created
  const sub1 = await adoClient.createServiceHookSubscription({
    publisherId: 'tfs',
    eventType: 'git.pullrequest.created',
    consumerId: 'webHooks',
    consumerActionId: 'httpRequest',
    publisherInputs: { projectId },
    consumerInputs: {
      url: `https://api.yourservice.com/webhooks/ado/${tenantId}`,
      basicAuthUsername: tenantId,
      basicAuthPassword: webhookSecret,
      resourceDetailsToSend: 'all',
    },
  });

  // Create service hook for PR updated
  const sub2 = await adoClient.createServiceHookSubscription({
    // ... same but eventType: 'git.pullrequest.updated'
  });

  // Store enrollment
  await projectRepo.create({
    tenantId,
    adoProjectId: projectId,
    webhookSubscriptionIds: [sub1.id, sub2.id],
    webhookSecretEnc: encrypt(webhookSecret, encryptionKey),
    status: 'active',
  });
}
```

**Reviews & Usage:**
```
GET /api/reviews?page=1&limit=20&projectId=...
  Response: { items: [...], total: 150, page: 1 }

GET /api/usage
  Response: { period: '2026-02', reviewsCount: 47, tokensUsed: 125000, limit: 500 }
```

---

### 4.6 Azure DevOps Marketplace Extension (Week 4-6)

**Objective:** Build the extension that users install from the Marketplace for 1-click onboarding.

#### Extension Basics

An Azure DevOps extension is a `.vsix` file containing:
- `vss-extension.json` -- Manifest declaring contributions, scopes, endpoints
- Static web assets (HTML/JS/CSS for hub pages running in iframes)
- Icons and marketplace listing content

The extension itself **does not contain backend code**. Our Fastify service is the backend. The extension's hub pages call our management API.

#### Project Structure

```
extension/
  vss-extension.json          # Extension manifest
  package.json
  tsconfig.json
  vite.config.ts
  assets/
    icon.png
    icon-large.png
  src/
    shared/
      api.ts                  # Backend API client (fetch wrapper)
      auth.ts                 # ADO SDK auth helpers (getAccessToken)
      types.ts                # Shared TypeScript types
    org-settings/
      index.html              # Entry point for org settings hub
      OrgSettings.tsx         # Main component
      ConnectionStatus.tsx    # OAuth connection widget
      OrgConfig.tsx           # Org-wide config form
    project-settings/
      index.html              # Entry point for project settings hub
      ProjectSettings.tsx     # Main component
      ProjectList.tsx         # List of projects with enable/disable toggles
      RepoConfigPanel.tsx     # Per-repo config overrides (Phase 2)
    pr-tab/                   # (Phase 2)
      index.html
      ReviewTab.tsx
```

#### Extension Manifest (`vss-extension.json`)

```json
{
  "manifestVersion": 1,
  "id": "llm-code-review",
  "publisher": "YourPublisherName",
  "version": "1.0.0",
  "name": "AI Code Review",
  "description": "Automated LLM-powered code review for Azure DevOps pull requests",
  "categories": ["Azure Repos"],
  "targets": [{ "id": "Microsoft.VisualStudio.Services" }],
  "icons": {
    "default": "assets/icon.png"
  },
  "scopes": [
    "vso.code_write",
    "vso.code_status",
    "vso.hooks_write",
    "vso.project"
  ],
  "contributions": [
    {
      "id": "org-settings-hub",
      "type": "ms.vss-web.hub",
      "targets": ["ms.vss-web.collection-admin-hub-group"],
      "properties": {
        "name": "AI Code Review",
        "uri": "dist/org-settings/index.html",
        "icon": "assets/icon.png"
      }
    },
    {
      "id": "project-settings-hub",
      "type": "ms.vss-web.hub",
      "targets": ["ms.vss-web.project-admin-hub-group"],
      "properties": {
        "name": "AI Code Review",
        "uri": "dist/project-settings/index.html",
        "icon": "assets/icon.png"
      }
    },
    {
      "id": "pr-review-tab",
      "type": "ms.vss-code-web.pr-tab",
      "targets": ["ms.vss-code-web.pr-details-view"],
      "properties": {
        "name": "AI Review",
        "uri": "dist/pr-tab/index.html",
        "order": 99
      }
    }
  ],
  "files": [
    { "path": "dist", "addressable": true },
    { "path": "assets", "addressable": true }
  ]
}
```

#### Hub Page Details

**A. Organization Settings Hub** (`collection-admin-hub-group`)

Located under Organization Settings in ADO. This is the first thing users see after installing.

Features:
- **Connection Status** -- Shows if OAuth is connected, token health, last refresh time
- **Connect/Disconnect Button** -- Initiates OAuth flow or revokes connection
- **Org-Wide Config** -- Review strictness slider, enable/disable features, comment style
- **Plan Info** -- Current plan, usage stats, upgrade link

```
┌─────────────────────────────────────────────┐
│ AI Code Review - Organization Settings      │
├─────────────────────────────────────────────┤
│                                             │
│ Connection Status: ● Connected              │
│ Organization: contoso                       │
│ Connected by: john@contoso.com              │
│ Token expires: in 45 minutes (auto-refresh) │
│                                             │
│ [Disconnect]                                │
│                                             │
├─────────────────────────────────────────────┤
│ Review Settings                             │
│                                             │
│ Strictness: [Relaxed] [Balanced*] [Strict]  │
│ Min Severity: [Info*] [Warning] [Error]     │
│ Comment Style: [Inline*] [Summary] [Both]   │
│                                             │
│ Features:                                   │
│ [x] Code Review                             │
│ [x] Accessibility (Text)                    │
│ [ ] Accessibility (Visual)                  │
│ [x] Security Analysis                       │
│                                             │
├─────────────────────────────────────────────┤
│ Plan: Free (47/50 reviews this month)       │
│ [Upgrade to Pro]                            │
└─────────────────────────────────────────────┘
```

**B. Project Settings Hub** (`project-admin-hub-group`)

Located under Project Settings. Users enable/disable the service per project.

Features:
- **Project Toggle** -- Enable/disable AI review for this project
- **Repo List** -- Shows all repos in the project with individual enable toggles
- **Status** -- Webhook health, last review time

```
┌─────────────────────────────────────────────┐
│ AI Code Review - Project Settings           │
├─────────────────────────────────────────────┤
│                                             │
│ AI Review for "MyProject": [Enabled ✓]      │
│ Webhook Status: ● Active                    │
│ Last review: 2 hours ago                    │
│                                             │
├─────────────────────────────────────────────┤
│ Repositories                                │
│                                             │
│ ┌───────────────────────┬────────┬────────┐ │
│ │ Repository            │ Status │ Action │ │
│ ├───────────────────────┼────────┼────────┤ │
│ │ frontend-app          │ Active │ [⚙]    │ │
│ │ backend-api           │ Active │ [⚙]    │ │
│ │ docs                  │ Off    │ [⚙]    │ │
│ │ infrastructure        │ Off    │ [⚙]    │ │
│ └───────────────────────┴────────┴────────┘ │
│                                             │
│ [⚙] = Per-repo config overrides (Phase 2)  │
└─────────────────────────────────────────────┘
```

**C. PR Tab** (Phase 2 -- `ms.vss-code-web.pr-details-view`)

A custom tab on the Pull Request detail page.

Features:
- Review status (pending/in-progress/completed/failed)
- Findings summary grouped by severity
- Token usage for this review
- Re-trigger review button
- Feedback (thumbs up/down on review quality)

#### Extension Tech Stack

- **React 18** + TypeScript
- **azure-devops-extension-sdk** -- Communication with ADO host frame
- **azure-devops-ui** -- Microsoft's official component library (matches ADO look & feel)
- **Vite** -- Bundling (multiple entry points, one per hub page)

#### API Communication from Extension

```typescript
// extension/src/shared/api.ts
import * as SDK from 'azure-devops-extension-sdk';

const BACKEND_URL = 'https://api.yourservice.com';

async function apiCall<T>(path: string, options?: RequestInit): Promise<T> {
  // Get ADO extension token for authentication
  const token = await SDK.getAccessToken();

  const response = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }

  return response.json();
}

// Usage in components:
const tenant = await apiCall<TenantInfo>('/api/tenants/me');
const projects = await apiCall<Project[]>('/api/projects');
await apiCall('/api/projects/abc/enable', { method: 'POST' });
```

---

### 4.7 Infrastructure Updates (Week 5-6)

#### Azure Resources to Add

| Resource | Purpose |
|----------|---------|
| Azure Database for PostgreSQL (Flexible Server) | Multi-tenant data store |
| Azure Key Vault | Store TOKEN_ENCRYPTION_KEY, OAUTH_CLIENT_SECRET |
| DNS / Custom domain | `api.yourservice.com` pointing to Container App |

#### Updated `infra/setup.sh`

Add provisioning for:
```bash
# PostgreSQL
az postgres flexible-server create \
  --name pg-code-review \
  --resource-group rg-code-review \
  --sku-name Standard_B1ms \
  --storage-size 32 \
  --admin-user pgadmin \
  --admin-password "$PG_PASSWORD"

# Key Vault
az keyvault create \
  --name kv-code-review \
  --resource-group rg-code-review

az keyvault secret set \
  --vault-name kv-code-review \
  --name token-encryption-key \
  --value "$(openssl rand -hex 32)"

# Update Container App with new env vars
az containerapp update \
  --name ca-llm-review \
  --resource-group rg-code-review \
  --set-env-vars \
    DATABASE_URL=secretref:database-url \
    OAUTH_CLIENT_ID=$OAUTH_CLIENT_ID \
    OAUTH_CLIENT_SECRET=secretref:oauth-client-secret \
    TOKEN_ENCRYPTION_KEY=secretref:token-encryption-key \
    OAUTH_REDIRECT_URI=$OAUTH_REDIRECT_URI \
    DEPLOYMENT_MODE=saas
```

#### Updated Dockerfile

```dockerfile
# Add migration step
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/src/db/migrations ./migrations

USER appuser
EXPOSE 3000

# Run migrations then start server
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/server.js"]
```

#### Updated Docker Compose (local dev)

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: llm_review
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: localdev
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s

  llm-review-service:
    build: .
    ports:
      - "3000:3000"
    env_file: .env
    environment:
      DATABASE_URL: postgres://postgres:localdev@postgres:5432/llm_review
      REDIS_URL: redis://redis:6379
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

volumes:
  postgres_data:
```

---

## 5. Phase 2: Growth (Weeks 7-12)

### 5.1 Per-Repo Configuration (Week 7-8)

Allow different settings per repository, overriding org-wide defaults.

**Database:** Add `repo_configs` table with nullable override fields.

**Config Resolution Logic:**
```
Effective Config = plan_limits (caps)
                   <- tenant_configs (org defaults)
                   <- repo_configs (repo overrides, non-null fields only)
```

**New file: `src/config/configResolver.ts`**
```typescript
interface EffectiveReviewConfig {
  llmMode: 'managed' | 'byok';
  llmProvider: string;
  llmApiKey?: string;
  llmModel: string;
  reviewStrictness: string;
  fileIncludeGlob?: string;
  fileExcludeGlob?: string;
  enableA11yText: boolean;
  enableA11yVisual: boolean;
  minSeverity: string;
  maxFiles: number;
}

async function resolveConfig(
  tenantId: string,
  projectId: string,
  repoId: string
): Promise<EffectiveReviewConfig> {
  const [tenant, tenantConfig, repoConfig, planLimits] = await Promise.all([
    tenantRepo.findById(tenantId),
    configRepo.findByTenantId(tenantId),
    configRepo.findByRepoId(tenantId, projectId, repoId),  // may be null
    planRepo.findByPlan(tenant.plan),
  ]);
  return merge(tenantConfig, repoConfig, planLimits);
}
```

**Extension UI:** Add per-repo config panel in Project Settings Hub (strictness dropdown, file glob editor, feature toggles).

---

### 5.2 BYOK LLM Support (Week 8-9)

Allow tenants to use their own LLM API keys.

**New file: `src/llm/llmRouter.ts`**
```
Review Pipeline
      |
      v
  LlmRouter
      |
      +--> ManagedLlmProvider  (our API keys, metered, included in plan)
      |         +--> Anthropic API
      |         +--> OpenAI API
      |
      +--> ByokLlmProvider     (customer's API key, unmetered by us)
                +--> customer's configured endpoint
```

**Implementation:**
- `LlmRouter` checks tenant config's `llmMode`
- `ManagedLlmProvider` wraps existing provider code, uses our keys
- `ByokLlmProvider` uses customer's decrypted API key
- Both record usage metrics (tokens, duration) for analytics
- BYOK key validated on save with a minimal test API call

**Extension UI:** Add BYOK settings in Org Settings Hub:
- Provider dropdown (OpenAI / Anthropic / Azure OpenAI)
- API key input (masked, write-only)
- Endpoint URL (for Azure OpenAI)
- Model selection
- "Test Connection" button

**Security:** BYOK API keys are:
- Encrypted in DB (AES-256-GCM, same as OAuth tokens)
- Never returned in API responses (write-only)
- Masked in all logs
- Validated before saving

---

### 5.3 PR Status Integration (Week 9-10)

Post review status as a PR check that can be used as a branch policy.

**Changes to `src/review/runReview.ts`:**
```typescript
// At review start:
await adoClient.createPullRequestStatus(repoId, prId, {
  state: 'pending',
  description: 'AI Code Review in progress...',
  context: { name: 'ai-code-review/review', genre: 'llm-review' },
  targetUrl: `https://app.yourservice.com/reviews/${reviewId}`,
});

// At review completion:
const state = criticalFindings > 0 ? 'failed' : 'succeeded';
await adoClient.createPullRequestStatus(repoId, prId, {
  state,
  description: `${findings.length} findings (${criticalFindings} critical)`,
  context: { name: 'ai-code-review/review', genre: 'llm-review' },
  targetUrl: `https://app.yourservice.com/reviews/${reviewId}`,
});
```

**Branch Policy:** Users can add the `ai-code-review/review` status as a required check in their branch policy settings. This makes the AI review a merge gate.

**PR Tab:** Custom tab on the PR detail view showing:
- Review status with timestamp
- Findings grouped by severity
- Re-trigger button
- Token usage
- Feedback (thumbs up/down)

---

### 5.4 Usage Tracking & Billing Foundation (Week 10-11)

**Database additions:**
- `usage_daily` -- Daily aggregation per tenant
- `plan_limits` -- Limits per plan tier

**Plan Tiers:**

| Feature | Free | Pro | Enterprise |
|---------|------|-----|-----------|
| Reviews/month | 50 | 500 | Unlimited |
| Repos | 3 | 20 | Unlimited |
| Projects | 1 | 5 | Unlimited |
| Tokens/month | 500K | 5M | Unlimited |
| BYOK | No | Yes | Yes |
| Visual A11y | No | Yes | Yes |
| Priority queue | No | No | Yes |

**Enforcement:**
```typescript
// Before running review:
const usage = await usageRepo.getCurrentMonthUsage(tenantId);
const limits = await planRepo.getLimits(tenant.plan);

if (limits.maxReviewsPerMonth && usage.reviewsCount >= limits.maxReviewsPerMonth) {
  // Don't run review; post PR comment instead
  await adoClient.createPullRequestThread(repoId, prId, {
    comments: [{
      content: `AI Code Review limit reached (${usage.reviewsCount}/${limits.maxReviewsPerMonth} reviews this month). [Upgrade to Pro](https://yourservice.com/upgrade) for more reviews.`
    }]
  });
  return;
}
```

**Usage Dashboard:** In Org Settings Hub:
- Bar chart: reviews per day
- Line chart: tokens consumed per day
- Current period stats with plan limits
- Usage by project breakdown

---

### 5.5 Review Quality Improvements (Week 11-12)

**Auto-resolve old comments:**
When a PR is updated and previous review findings are no longer relevant (the code was fixed), automatically resolve the old comment threads.

```typescript
// Compare new findings with old findings for the same PR
// If an old finding's file+line+issue no longer appears, resolve the thread
const oldFindings = await findingRepo.getByPr(tenantId, repoId, prId);
const resolvedFindings = oldFindings.filter(old =>
  !newFindings.some(n => n.filePath === old.filePath && n.category === old.category)
);
for (const finding of resolvedFindings) {
  await adoClient.updateThreadStatus(repoId, prId, finding.adoThreadId, 'closed');
}
```

**Feedback mechanism:**
- Add thumbs up/down buttons on review findings (via PR Tab)
- Store feedback for future model improvement
- Track false positive rate per tenant/repo

---

## 6. Phase 3: Enterprise (Weeks 13-20)

### Phase 3 Implementation Status

**Completed:**
- Custom review rules (structured, sandboxed, 25/scope cap) -- `src/review/reviewRules.ts`, `src/db/repos/rulesRepo.ts`, `src/routes/api/rules.ts`
- Audit log export (JSON + CSV, 90-day cap) -- `src/routes/api/auditExport.ts`, `src/db/repos/auditExportRepo.ts`
- Self-hosted Docker Compose distribution -- `deploy/self-hosted/`
- Auto-tenant bootstrap on startup -- `src/selfHosted/bootstrap.ts`
- Setup wizard (hybrid interactive/validation) -- `deploy/self-hosted/setup.sh`
- Auto-migrate on startup -- already in `src/server.ts`

**Deferred to Phase 4:**
- Billing integration (Stripe / Azure Marketplace)
- Org analytics dashboard
- Multi-model routing per stage
- Data residency (regional deployments)
- SSO/SCIM for self-hosted admin UI
- Helm Chart distribution (TODO)
- Bicep/ARM Template distribution (TODO)

---

### 6.1 Self-Hosted Distribution (Docker Compose)

**`DEPLOYMENT_MODE=self-hosted` changes:**
- Multi-tenancy disabled (single tenant, auto-created on startup)
- OAuth optional; PAT auth supported (kept from current codebase)
- BYOK mandatory (managed LLM keys not exposed)
- Billing enforcement disabled (informational only)
- Auto-migrate on startup (pending migrations run on boot)

**Distribution (implemented):**

**Docker Compose** (`deploy/self-hosted/`):
```
deploy/self-hosted/
  docker-compose.yml    # App + Postgres + Redis (optional) + Axon (optional)
  .env.example          # Configuration template with comments
  setup.sh              # Hybrid wizard: interactive first run, Level 3 validation on subsequent runs
```

**Setup wizard features:**
- Interactive first-run: prompts for ADO connection, LLM provider, database, optional features
- Level 3 validation: checks presence + format + connectivity (PostgreSQL, ADO API, LLM API key)
- Generates `.env` and webhook secret automatically

**Future distribution options (TODO):**
- **Helm Chart** for Kubernetes deployments
- **Bicep/ARM Template** for Azure Container Apps

---

### 6.2 Custom Review Rules

**Structured rules only** (no free-text to prevent prompt injection):

```typescript
{
  name: string;        // "no-any-type" (lowercase, hyphenated, max 100 chars)
  description: string; // max 500 chars
  category: "naming" | "security" | "style" | "patterns" | "documentation";
  severity: "info" | "low" | "medium" | "high" | "critical";
  fileGlob?: string;   // "*.ts" (max 200 chars)
  instruction: string; // max 500 chars
  exampleGood?: string; // max 1000 chars
  exampleBad?: string;  // max 1000 chars
  enabled: boolean;
}
```

**Security:**
- Keyword blocklist on all text fields (detects prompt injection attempts)
- Rules sandboxed in LLM prompt with XML-like tags and preamble
- Max 25 rules per scope (tenant or repo level)

**3-layer model:** Tenant-level rules + repo-level overrides, following the existing config merge pattern.

**API endpoints:**
- `GET /api/rules` — list tenant-level rules
- `POST /api/rules` — create tenant-level rule
- `PUT /api/rules/:ruleId` — update rule
- `DELETE /api/rules/:ruleId` — delete rule
- `GET /api/repos/:repoId/rules` — list repo-level rules
- `POST /api/repos/:repoId/rules` — create repo-level rule
- `GET /api/repos/:repoId/rules/effective` — list effective rules (tenant + repo)

---

### 6.3 Audit Log Export

**Data:** Reviews + individual findings (joined).

**API endpoint:** `GET /api/export/audit?from=YYYY-MM-DD&to=YYYY-MM-DD&format=json|csv`

**Constraints:**
- 90-day max date range per request
- JSON format: nested structure (reviews → findings array)
- CSV format: flattened (one row per finding, review fields repeated)

---

### 6.4 Billing Integration — DEFERRED

Deferred until there are paying customers. Plan assignment remains manual via DB.

---

### 6.5 Advanced Features — DEFERRED to Phase 4

| Feature | Status |
|---------|--------|
| Org analytics dashboard | Phase 4 |
| Multi-model routing per stage | Phase 4 |
| Data residency (EU, US) | Phase 4 |
| SSO/SCIM | Phase 4 |

---

## 7. Database Schema

### Core Tables (Phase 1)

```sql
-- Tenants: one per Azure DevOps Organization
CREATE TABLE tenants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ado_org_id      VARCHAR(255) NOT NULL UNIQUE,
    ado_org_name    VARCHAR(255) NOT NULL,
    display_name    VARCHAR(255),
    status          VARCHAR(50) NOT NULL DEFAULT 'active',
    plan            VARCHAR(50) NOT NULL DEFAULT 'free',
    installed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    installed_by    VARCHAR(255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Encrypted OAuth tokens
CREATE TABLE tenant_oauth_tokens (
    tenant_id           UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    access_token_enc    BYTEA NOT NULL,
    refresh_token_enc   BYTEA NOT NULL,
    token_type          VARCHAR(50) NOT NULL DEFAULT 'Bearer',
    expires_at          TIMESTAMPTZ NOT NULL,
    scopes              TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Org-wide configuration defaults
CREATE TABLE tenant_configs (
    tenant_id           UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    llm_mode            VARCHAR(20) NOT NULL DEFAULT 'managed',
    llm_provider        VARCHAR(50) DEFAULT 'anthropic',
    llm_api_key_enc     BYTEA,
    llm_endpoint        VARCHAR(500),
    llm_model_review    VARCHAR(100) DEFAULT 'claude-sonnet-4-6',
    llm_model_a11y      VARCHAR(100) DEFAULT 'claude-sonnet-4-6',
    review_strictness   VARCHAR(20) DEFAULT 'balanced',
    max_files           INTEGER DEFAULT 50,
    max_diff_size       INTEGER DEFAULT 100000,
    file_include_glob   TEXT,
    file_exclude_glob   TEXT,
    enable_a11y_text    BOOLEAN DEFAULT true,
    enable_a11y_visual  BOOLEAN DEFAULT false,
    enable_security     BOOLEAN DEFAULT true,
    auto_resolve_on_fix BOOLEAN DEFAULT false,
    comment_style       VARCHAR(20) DEFAULT 'inline',
    min_severity        VARCHAR(20) DEFAULT 'low',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Which projects have the service enabled
CREATE TABLE project_enrollments (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    ado_project_id          VARCHAR(255) NOT NULL,
    ado_project_name        VARCHAR(255) NOT NULL,
    status                  VARCHAR(50) NOT NULL DEFAULT 'active',
    webhook_subscription_id VARCHAR(255),
    webhook_secret_enc      BYTEA,
    status_policy_enabled   BOOLEAN DEFAULT false,
    status_policy_id        VARCHAR(255),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, ado_project_id)
);

-- Review audit log (replaces .data/audit.jsonl)
CREATE TABLE reviews (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id),
    ado_project_id      VARCHAR(255) NOT NULL,
    ado_repo_id         VARCHAR(255) NOT NULL,
    pull_request_id     INTEGER NOT NULL,
    pull_request_title  TEXT,
    author              VARCHAR(255),
    status              VARCHAR(50) NOT NULL DEFAULT 'queued',
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    duration_ms         INTEGER,
    error_message       TEXT,
    files_reviewed      INTEGER DEFAULT 0,
    findings_count      INTEGER DEFAULT 0,
    findings_by_severity JSONB,
    llm_provider_used   VARCHAR(50),
    llm_model_used      VARCHAR(100),
    prompt_tokens       INTEGER DEFAULT 0,
    completion_tokens   INTEGER DEFAULT 0,
    total_tokens        INTEGER DEFAULT 0,
    llm_cost_usd        DECIMAL(10,6),
    diff_size_chars     INTEGER,
    files_in_pr         INTEGER,
    idempotency_key     VARCHAR(500) NOT NULL UNIQUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reviews_tenant ON reviews(tenant_id, created_at DESC);
CREATE INDEX idx_reviews_lookup ON reviews(tenant_id, ado_repo_id, pull_request_id);

-- Individual findings per review
CREATE TABLE review_findings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id       UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    tenant_id       UUID NOT NULL,
    stage           VARCHAR(50) NOT NULL,
    file_path       TEXT,
    line_start      INTEGER,
    line_end        INTEGER,
    severity        VARCHAR(20) NOT NULL,
    category        VARCHAR(100),
    title           TEXT,
    body            TEXT NOT NULL,
    suggestion      TEXT,
    ado_thread_id   INTEGER,
    ado_comment_id  INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_findings_review ON review_findings(review_id);
```

### Phase 2 Additions

```sql
-- Per-repo config overrides (nullable fields override tenant defaults)
CREATE TABLE repo_configs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    ado_project_id      VARCHAR(255) NOT NULL,
    ado_repo_id         VARCHAR(255) NOT NULL,
    ado_repo_name       VARCHAR(255),
    llm_model_review    VARCHAR(100),
    review_strictness   VARCHAR(20),
    file_include_glob   TEXT,
    file_exclude_glob   TEXT,
    enable_a11y_text    BOOLEAN,
    enable_a11y_visual  BOOLEAN,
    enable_security     BOOLEAN,
    min_severity        VARCHAR(20),
    max_files           INTEGER,
    enabled             BOOLEAN DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, ado_project_id, ado_repo_id)
);

-- Daily usage aggregation
CREATE TABLE usage_daily (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id),
    date                DATE NOT NULL,
    reviews_count       INTEGER DEFAULT 0,
    findings_count      INTEGER DEFAULT 0,
    prompt_tokens       BIGINT DEFAULT 0,
    completion_tokens   BIGINT DEFAULT 0,
    total_tokens        BIGINT DEFAULT 0,
    estimated_cost      DECIMAL(10,4) DEFAULT 0,
    UNIQUE(tenant_id, date)
);

CREATE INDEX idx_usage_tenant_date ON usage_daily(tenant_id, date DESC);

-- Plan limits
CREATE TABLE plan_limits (
    plan                    VARCHAR(50) PRIMARY KEY,
    max_reviews_per_month   INTEGER,
    max_repos               INTEGER,
    max_projects            INTEGER,
    max_tokens_per_month    BIGINT,
    byok_allowed            BOOLEAN DEFAULT false,
    custom_models_allowed   BOOLEAN DEFAULT false,
    a11y_visual_allowed     BOOLEAN DEFAULT false,
    priority_queue          BOOLEAN DEFAULT false
);

INSERT INTO plan_limits VALUES
    ('free',       50,    3,    1,    500000,   false, false, false, false),
    ('pro',        500,   20,   5,    5000000,  true,  true,  true,  false),
    ('enterprise', NULL,  NULL, NULL, NULL,      true,  true,  true,  true);
```

---

## 8. OAuth 2.0 Implementation

### Token Lifecycle

```
Install Extension
      |
      v
User clicks "Connect" in Org Settings Hub
      |
      v
GET /auth/ado/authorize
  -> Redirect to ADO OAuth authorization page
      |
      v
User authorizes scopes
      |
      v
ADO redirects to GET /auth/ado/callback?code=...&state=...
      |
      v
Backend exchanges code for tokens
  -> POST https://app.vssps.visualstudio.com/oauth2/token
      |
      v
Tokens encrypted and stored in tenant_oauth_tokens
      |
      v
Background refresh job runs every 45 minutes
  -> Refreshes tokens expiring within 15 minutes
  -> ADO tokens expire after 1 hour
  -> Each refresh produces new access + refresh tokens
      |
      v
On every ADO API call:
  -> TokenManager checks expiry (5-min buffer)
  -> Refreshes if needed
  -> Returns valid access token
```

### Failure Handling

```
Token refresh fails?
      |
      +--> Retry 3 times with exponential backoff
      |
      +--> Still failing?
              |
              v
        Mark tenant as 'needs_reauth'
        Stop processing their webhooks
        Post PR comment: "Authorization expired, please re-authorize"
        Send email notification to admin (if configured)
```

### Security

| Measure | Implementation |
|---------|---------------|
| Encryption at rest | AES-256-GCM for all tokens; encryption key from Azure Key Vault |
| CSRF protection | `state` parameter in OAuth flow (random nonce, validated on callback) |
| Scope minimization | Request only needed scopes (code_write, hooks_write, etc.) |
| Token rotation | Each refresh produces new refresh token; old one is invalidated |
| Secure storage | Never log tokens; Pino redaction; tokens only decrypted in memory |

---

## 9. Azure DevOps Marketplace Extension

### Extension Development Guide

#### Prerequisites

```bash
npm install -g tfx-cli  # Azure DevOps extension CLI
```

#### Key Dependencies

```json
{
  "dependencies": {
    "azure-devops-extension-sdk": "^4.0.0",
    "azure-devops-ui": "^2.167.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "typescript": "^5.7.0",
    "vite": "^5.0.0"
  }
}
```

#### Build & Package

```bash
cd extension
npm install
npm run build        # Vite build
tfx extension create # Creates .vsix file
```

#### Publish

```bash
# First time: create publisher at https://marketplace.visualstudio.com/manage
tfx extension publish \
  --publisher YourPublisherName \
  --token $MARKETPLACE_PAT \
  --share-with your-test-org  # For private preview
```

#### Development Workflow

1. Use `tfx extension create` to build `.vsix`
2. Upload to test org as private extension
3. Test in ADO (hub pages reload from extension assets)
4. Use browser DevTools for debugging (extension runs in iframe)
5. Backend API changes deploy independently (Fastify service)

#### Extension SDK Initialization

Every hub page must initialize the SDK:

```typescript
// extension/src/shared/init.ts
import * as SDK from 'azure-devops-extension-sdk';

export async function initializeExtension(): Promise<void> {
  await SDK.init();
  await SDK.ready();
}

// Usage in hub entry point:
import { initializeExtension } from '../shared/init';
import { createRoot } from 'react-dom/client';
import { OrgSettings } from './OrgSettings';

initializeExtension().then(() => {
  const root = createRoot(document.getElementById('root')!);
  root.render(<OrgSettings />);
});
```

---

## 10. LLM Proxy Layer

### Architecture

```
                    ┌─────────────┐
                    │ LlmRouter   │
                    │             │
                    │ Checks:     │
                    │ - tenant    │
                    │   config    │
                    │ - plan      │
                    │   limits    │
                    │ - usage     │
                    │   budget    │
                    └──────┬──────┘
                           │
            ┌──────────────┴──────────────┐
            │                             │
    ┌───────┴───────┐            ┌────────┴────────┐
    │ Managed       │            │ BYOK            │
    │ Provider      │            │ Provider        │
    │               │            │                 │
    │ Our API keys  │            │ Customer's key  │
    │ Metered usage │            │ Unmetered       │
    │ Model per     │            │ Customer picks  │
    │ plan tier     │            │ model & endpoint│
    └───────┬───────┘            └────────┬────────┘
            │                             │
     ┌──────┴──────┐              ┌───────┴───────┐
     │ Anthropic   │              │ Any supported │
     │ OpenAI      │              │ provider      │
     │ Azure AOAI  │              │               │
     └─────────────┘              └───────────────┘
```

### LlmRouter Implementation

```typescript
class LlmRouter {
  async complete(
    tenantId: string,
    stage: 'preprocessor' | 'reviewer' | 'a11y_text' | 'a11y_visual',
    messages: ChatMessage[],
    config: EffectiveReviewConfig
  ): Promise<LlmResponse> {

    // 1. Check plan budget
    const usage = await usageRepo.getCurrentMonthUsage(tenantId);
    const limits = await planRepo.getLimits(config.plan);
    if (limits.maxTokensPerMonth && usage.totalTokens >= limits.maxTokensPerMonth) {
      throw new BudgetExceededError(tenantId);
    }

    // 2. Route to correct provider
    const provider = config.llmMode === 'byok'
      ? new ByokLlmProvider(config.llmProvider, config.llmApiKey!, config.llmEndpoint)
      : new ManagedLlmProvider(stage, config.plan);

    // 3. Execute with timing
    const start = Date.now();
    const response = await provider.complete(messages, { model: config.llmModel });
    const duration = Date.now() - start;

    // 4. Record usage (for both managed and BYOK)
    await usageRecorder.record({
      tenantId,
      stage,
      provider: config.llmProvider,
      model: config.llmModel,
      promptTokens: response.usage.promptTokens,
      completionTokens: response.usage.completionTokens,
      durationMs: duration,
      isByok: config.llmMode === 'byok',
    });

    return response;
  }
}
```

### Rate Limiting & Abuse Prevention

| Mode | Limit Type | Implementation |
|------|-----------|---------------|
| Managed | Per-tenant token budget (monthly) | Check before LLM call; reject with upgrade prompt |
| Managed | Concurrent reviews per plan | BullMQ concurrency per tenant (free: 1, pro: 3, enterprise: 10) |
| BYOK | Review count rate limit | Same per-plan review limits (protect our infrastructure) |
| Both | Circuit breaker | If tenant's error rate > 50% in 5 min, pause for 10 min |

---

## 11. Self-Hosted Distribution

### Architecture Differences

| Aspect | SaaS | Self-Hosted |
|--------|------|-------------|
| Multi-tenancy | Yes (N orgs) | No (single org) |
| Auth | OAuth (automatic) | PAT or OAuth (customer configures) |
| LLM | Managed (default) + BYOK | BYOK only (customer provides keys) |
| Database | Azure PostgreSQL (we manage) | Customer provides PostgreSQL |
| Redis | Azure Redis (we manage) | Customer provides Redis |
| Billing | Enforced | Informational only |
| Admin UI | Extension hubs | Extension hubs + built-in admin page |
| Updates | Continuous (we deploy) | Customer pulls new image version |

### Self-Hosted Startup Behavior

When `DEPLOYMENT_MODE=self-hosted`:

```typescript
// On startup:
if (config.DEPLOYMENT_MODE === 'self-hosted') {
  // Auto-create single tenant from env vars
  await tenantRepo.upsert({
    adoOrgId: config.ADO_ORG_ID || 'self-hosted',
    adoOrgName: config.ADO_ORG_NAME || 'Self-Hosted',
    status: 'active',
    plan: 'enterprise',  // No limits in self-hosted
  });

  // If PAT provided, store it (no OAuth needed)
  if (config.ADO_PAT) {
    await tokenStore.storePat(tenant.id, config.ADO_PAT);
  }

  // Create default config from env vars
  await configRepo.upsert(tenant.id, {
    llmMode: 'byok',
    llmProvider: config.LLM_PROVIDER,
    llmApiKeyEnc: encrypt(config.LLM_API_KEY, encryptionKey),
    llmModelReview: config.LLM_MODEL,
    reviewStrictness: config.REVIEW_STRICTNESS || 'balanced',
    // ... other settings from env
  });
}
```

### Extension Pointing to Self-Hosted

The marketplace extension includes a **service endpoint configuration** where self-hosted customers enter their backend URL:

```json
// In vss-extension.json
{
  "id": "service-endpoint",
  "type": "ms.vss-endpoint.service-endpoint-type",
  "targets": ["ms.vss-endpoint.endpoint-types"],
  "properties": {
    "name": "AiCodeReviewEndpoint",
    "displayName": "AI Code Review Service",
    "url": {
      "displayName": "Backend URL",
      "value": "https://api.yourservice.com",
      "isVisible": true
    },
    "authenticationSchemes": [{
      "type": "ms.vss-endpoint.endpoint-auth-scheme-basic",
      "inputDescriptors": [{
        "id": "apiKey",
        "name": "API Key",
        "description": "API key for the self-hosted instance"
      }]
    }]
  }
}
```

The extension hub pages read this service endpoint URL and use it for all API calls. SaaS users use the default URL; self-hosted users configure their own.

### Deployment Guides

**Docker Compose (simplest):**
```bash
# 1. Download
curl -O https://raw.githubusercontent.com/you/ai-code-review/main/deploy/docker-compose.yml
curl -O https://raw.githubusercontent.com/you/ai-code-review/main/deploy/.env.example

# 2. Configure
cp .env.example .env
# Edit .env with your ADO PAT, LLM API key, etc.

# 3. Start
docker compose up -d

# 4. Verify
curl http://localhost:3000/health
```

**Helm (Kubernetes):**
```bash
helm repo add ai-code-review https://charts.yourservice.com
helm install ai-code-review ai-code-review/ai-code-review \
  --set ado.pat=$ADO_PAT \
  --set llm.provider=anthropic \
  --set llm.apiKey=$ANTHROPIC_API_KEY \
  --set database.host=my-postgres.example.com
```

---

## 12. Management API Surface

### Full Route Map

```
# Authentication
GET    /auth/ado/authorize                    # Initiate OAuth flow
GET    /auth/ado/callback                     # OAuth callback
DELETE /auth/ado/connection/:tenantId          # Revoke connection

# Tenant Management (ADO JWT auth)
GET    /api/tenants/me                        # Tenant info
PATCH  /api/tenants/me                        # Update tenant
GET    /api/tenants/me/status                 # Connection health

# Configuration (ADO JWT auth)
GET    /api/config                            # Org-wide config
PUT    /api/config                            # Update org-wide config

# Project Management (ADO JWT auth)
GET    /api/projects                          # List ADO projects (from ADO API)
GET    /api/projects/enrolled                 # List enrolled projects
POST   /api/projects/:projectId/enable        # Enable (creates webhook)
POST   /api/projects/:projectId/disable       # Disable (removes webhook)

# Repo Configuration (ADO JWT auth, Phase 2)
GET    /api/projects/:pid/repos               # List repos
GET    /api/projects/:pid/repos/:rid/config   # Get repo overrides
PUT    /api/projects/:pid/repos/:rid/config   # Set repo overrides
DELETE /api/projects/:pid/repos/:rid/config   # Remove overrides

# Reviews & Audit (ADO JWT auth)
GET    /api/reviews                           # List reviews (paginated)
GET    /api/reviews/:reviewId                 # Review detail + findings
POST   /api/reviews/:reviewId/retrigger       # Re-run review

# Usage & Billing (ADO JWT auth, Phase 2)
GET    /api/usage                             # Current period usage
GET    /api/usage/history                     # Historical usage

# Webhooks (Basic Auth per tenant)
POST   /webhooks/ado/:tenantId                # Receive ADO webhooks

# Health (no auth)
GET    /health                                # Liveness
GET    /health/ready                          # Readiness (DB + Redis)
```

### API Authentication

| Endpoint Group | Auth Method | How It Works |
|---------------|-------------|-------------|
| `/api/*` (SaaS) | ADO JWT | Extension SDK provides JWT; backend validates against ADO JWKS; extracts orgId |
| `/api/*` (Self-hosted) | API Key | Simple bearer token from env var |
| `/webhooks/ado/:tenantId` | Basic Auth | Per-tenant secret set when creating webhook subscription |
| `/auth/ado/*` | None (initiates flow) | State parameter prevents CSRF |
| `/health*` | None | Public health endpoints |

---

## 13. Security Considerations

| Area | Threat | Mitigation |
|------|--------|-----------|
| OAuth tokens | Token theft from DB | AES-256-GCM encryption; key in Azure Key Vault |
| OAuth tokens | Token interception | HTTPS everywhere; state parameter for CSRF |
| BYOK API keys | Key exposure | Encrypted in DB; write-only (never in API responses); masked in logs |
| Webhook spoofing | Fake webhooks trigger reviews | Per-tenant Basic Auth secret; org ID validation in payload |
| Tenant isolation | Cross-tenant data access | All DB queries include `tenant_id`; consider Postgres RLS |
| Extension JWT | JWT forgery | Validate against ADO JWKS; check aud/iss/exp claims |
| Rate limiting | DDoS / abuse | Per-tenant rate limits on webhook + API; BullMQ concurrency |
| LLM prompt injection | Malicious PR code manipulates LLM | Treat diffs as untrusted; system prompts reject embedded instructions; output schema validation |
| Self-hosted secrets | Env var exposure | Document secure secret management; support Key Vault refs |
| Audit trail | Tamper resistance | Append-only reviews table; no UPDATE/DELETE on reviews |
| CORS | Cross-origin attacks | Strict CORS: only allow extension origin + dashboard domain |

---

## 14. New & Modified Files

### New Files by Phase

#### Phase 1 (MVP)

```
src/
  config/
    appConfig.ts                    # Infrastructure config from env vars
    tenantConfig.ts                 # Per-tenant config types
  context/
    tenantContext.ts                # Bundles tenant info for pipeline
  db/
    connection.ts                  # PostgreSQL connection pool
    migrate.ts                     # Migration runner
    migrations/
      001_initial.sql              # Core tables
    repos/
      tenantRepo.ts                # Tenant CRUD
      projectRepo.ts               # Project enrollment CRUD
      reviewRepo.ts                # Review/audit CRUD
  auth/
    encryption.ts                  # AES-256-GCM encrypt/decrypt
    tokenManager.ts                # OAuth token lifecycle
  middleware/
    adoAuth.ts                     # ADO JWT validation
    rateLimiter.ts                 # Per-tenant rate limiting
  routes/
    auth.ts                        # OAuth flow routes
    api/
      index.ts                     # API router
      tenants.ts                   # Tenant endpoints
      config.ts                    # Config endpoints
      projects.ts                  # Project enable/disable
      reviews.ts                   # Review list/detail
  azure/
    adoClientFactory.ts            # Tenant-aware ADO client factory
  jobs/
    tokenRefresh.ts                # Background token refresh

extension/                         # ADO Marketplace Extension
  vss-extension.json
  package.json
  tsconfig.json
  vite.config.ts
  assets/
    icon.png
  src/
    shared/
      init.ts                      # SDK initialization
      api.ts                       # Backend API client
      auth.ts                      # ADO SDK auth helpers
      types.ts
    org-settings/
      index.html
      OrgSettings.tsx
      ConnectionStatus.tsx
      OrgConfig.tsx
    project-settings/
      index.html
      ProjectSettings.tsx
      ProjectList.tsx
```

#### Phase 2 (Growth)

```
src/
  config/
    configResolver.ts              # Merge tenant + repo config
  db/
    migrations/
      002_repo_configs.sql
      003_usage.sql
      004_findings.sql
    repos/
      configRepo.ts                # Config CRUD
      usageRepo.ts                 # Usage queries
  llm/
    llmRouter.ts                   # LLM routing abstraction
    providers/
      managedProvider.ts           # Our-key LLM provider
      byokProvider.ts              # Customer-key LLM provider
  routes/
    api/
      repoConfig.ts                # Repo config endpoints
      usage.ts                     # Usage endpoints
  jobs/
    usageAggregation.ts            # Daily usage rollup

extension/
  src/
    project-settings/
      RepoConfigPanel.tsx          # Per-repo config UI
    pr-tab/
      index.html
      ReviewTab.tsx
```

#### Phase 3 (Enterprise)

```
src/
  db/
    seed.ts                        # Self-hosted auto-seed
  routes/
    billing.ts                     # Payment webhooks
    admin/                         # Self-hosted admin UI
  billing/
    dunning.ts                     # Payment failure handling
  middleware/
    ipFilter.ts                    # IP allowlisting

charts/                            # Helm chart
  ai-code-review/
    Chart.yaml
    values.yaml
    templates/

infra/
  self-hosted/
    main.bicep
    parameters.json

deploy/
  docker-compose.yml               # Self-hosted simple deployment
  .env.example
  setup.sh

docs/
  self-hosted/
    installation.md
    upgrade.md
    troubleshooting.md
```

### Modified Files

| File | Phase | Change |
|------|-------|--------|
| `src/config.ts` | 1 | Split into `appConfig.ts` + `tenantConfig.ts`; replaced |
| `src/azure/adoClient.ts` | 1 | Accept auth at construction; support OAuth + PAT |
| `src/routes/webhooks.ts` | 1 | Route `/webhooks/ado/:tenantId`; tenant resolution; Basic Auth |
| `src/review/runReview.ts` | 1, 2 | Accept TenantContext; ConfigResolver; PR status; plan limits |
| `src/review/queue.ts` | 1 | Add tenantId to jobs; hydrate TenantContext in worker |
| `src/review/audit.ts` | 1 | Rewrite: file -> database |
| `src/review/idempotency.ts` | 1 | Rewrite: file -> database |
| `src/app.ts` | 1 | Register new routes; add middleware; DB lifecycle |
| `src/server.ts` | 1 | DB migration on startup; token refresh job |
| `docker-compose.yml` | 1 | Add Postgres service |
| `Dockerfile` | 1 | Add migration step |
| `infra/setup.sh` | 1 | Provision PostgreSQL, Key Vault |
| `package.json` | 1 | New dependencies |
| LLM stage files | 2 | Route through LlmRouter |

---

## 15. Risks & Mitigations

### High-Risk Items

#### 1. ADO OAuth Token Management
**Risk:** ADO tokens expire in 1 hour. Refresh failure = silent review failures.
**Mitigation:**
- Background refresh every 45 min with 3x retry
- On persistent failure: mark tenant `needs_reauth`, stop webhooks, notify admin
- Before every ADO API call: check token freshness (5-min buffer)
- Comprehensive logging of all token operations

#### 2. ADO Extension SDK Learning Curve
**Risk:** Limited documentation, iframe quirks, `azure-devops-ui` not well maintained.
**Mitigation:**
- Build minimal PoC extension first (just a settings page calling our API)
- Keep hub UI simple; redirect to hosted dashboard for complex flows
- Budget extra time for Phase 1.6

#### 3. Service Hook Subscription Management
**Risk:** Subscription creation can fail (permissions, quotas). Users might manually delete hooks.
**Mitigation:**
- Periodic health check: verify all registered subscriptions still exist in ADO
- Clear error messages when creation fails
- Graceful handling of webhook delivery failures
- Re-create subscription option in UI

#### 4. Tenant Data Isolation
**Risk:** Query bugs could leak data across tenants.
**Mitigation:**
- All repository methods require `tenantId` -- no method queries without tenant scope
- Integration tests that verify cross-tenant isolation
- Consider PostgreSQL Row-Level Security as defense-in-depth

#### 5. LLM Cost Overruns (Managed Mode)
**Risk:** Active tenant could generate massive LLM costs.
**Mitigation:**
- Per-plan token budgets enforced before LLM call
- Hard monthly caps (cannot exceed)
- Alert at 80% budget consumption
- Circuit breaker: pause tenant if cost anomaly detected

#### 6. Migration from File-Based to DB Storage
**Risk:** Existing `.data/audit.jsonl` and `.data/idempotency.json` data lost.
**Mitigation:**
- One-time migration script reads files and inserts into DB
- Current deployment is single-tenant, so this is a one-time operation
- Run migration in a maintenance window

---

## 16. Key Architectural Decisions

### Decision 1: PostgreSQL over NoSQL
**Rationale:** The data model is relational (tenants -> projects -> repos -> reviews -> findings). Config resolution needs joins. Usage aggregation needs SQL. PostgreSQL JSONB handles semi-structured parts. Self-hosted customers widely have PostgreSQL available.

### Decision 2: Extension Hubs as Thin Clients
**Rationale:** ADO extension hubs run in iframes with limited real estate and awkward communication patterns. Keep hubs as thin UI shells calling our API. Complex flows (billing, analytics) redirect to a hosted dashboard.

### Decision 3: Tenant = ADO Organization
**Rationale:** Extensions install at org level. OAuth tokens are per-org. Billing is per-org. A project-level tenant model would require multiple OAuth authorizations per org and complicate billing.

### Decision 4: Keep PAT Support for Self-Hosted
**Rationale:** Self-hosted customers behind corporate firewalls may not use OAuth (especially ADO Server on-premises). PATs are simpler for single-tenant deployments where the customer controls the credential.

### Decision 5: Separate Management API from Webhook Endpoint
**Rationale:** Different auth mechanisms (ADO JWT vs Basic Auth), different rate limiting profiles, potentially different scaling needs. Could become separate services later.

### Decision 6: BullMQ (Redis) Retained for Job Queue
**Rationale:** BullMQ provides reliable job processing with retries, concurrency control, and priority queues. Already in the stack. Redis is simple for self-hosted customers to add.

---

## 17. Success Criteria

### Phase 1 (MVP)

- [ ] New ADO org can install extension from marketplace
- [ ] OAuth authorization completes; tokens stored encrypted in DB
- [ ] User enables project via Settings Hub; webhook auto-created in ADO
- [ ] PR creation/update triggers LLM review automatically
- [ ] Review findings posted as PR comments (same quality as current system)
- [ ] Audit trail written to PostgreSQL
- [ ] Idempotency prevents duplicate reviews (DB-backed)
- [ ] Token refresh works (reviews still work after 1+ hours)
- [ ] Two independent orgs use the service simultaneously without data leakage
- [ ] Existing test suite passes with multi-tenant refactoring

### Phase 2 (Growth)

- [ ] Tenant can override review settings per repository
- [ ] BYOK: tenant provides own OpenAI/Anthropic key; reviews use it
- [ ] PR status posted; can be used as branch policy
- [ ] Usage dashboard shows accurate consumption
- [ ] Plan limits enforced; over-limit tenants get clear messaging
- [ ] Auto-resolve works when PR is updated and issues are fixed

### Phase 3 (Enterprise)

- [ ] Self-hosted: Helm chart deploys working instance with customer's Postgres/Redis/LLM
- [ ] Self-hosted: extension works with custom backend URL
- [ ] Billing integration processes payments
- [ ] Audit log export available for compliance
- [ ] Custom review rules work (tenant-provided instructions)

---

## Appendix: Onboarding Flow (End-User Perspective)

### SaaS Onboarding (< 5 minutes)

```
Step 1: Install Extension
   User goes to Azure DevOps Marketplace
   Searches "AI Code Review"
   Clicks "Get it free" -> Installs to their org

Step 2: Authorize
   Goes to Organization Settings -> AI Code Review
   Clicks "Connect to AI Code Review"
   Authorizes OAuth scopes (code read/write, hooks)
   Redirected back with "Connected!" message

Step 3: Enable Projects
   Goes to Project Settings -> AI Code Review
   Sees list of projects
   Toggles on "MyProject"
   (webhook auto-created in the background)

Step 4: Done!
   Creates a Pull Request
   AI review runs automatically
   Findings appear as inline PR comments
   Summary posted as a thread
```

### Self-Hosted Onboarding (< 30 minutes)

```
Step 1: Deploy
   docker compose up -d
   (or helm install, or bicep deploy)

Step 2: Configure
   Set ADO PAT, LLM API key, etc. in .env
   Service auto-creates tenant on startup

Step 3: Install Extension
   Install from marketplace (same as SaaS)
   Configure service endpoint URL to point to self-hosted instance

Step 4: Enable Projects
   Same as SaaS Step 3 (via extension hub)
```
