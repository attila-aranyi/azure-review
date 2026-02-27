# llm-review-service

AI-powered code review service for Azure DevOps pull requests. Uses a multi-stage LLM pipeline to analyze diffs, detect bugs, security issues, and accessibility problems, then posts findings as inline PR comments.

Supports single-tenant (self-hosted) and multi-tenant (SaaS) deployment modes.

## Table of Contents

- [Architecture](#architecture)
- [Review Pipeline](#review-pipeline)
- [Quick Start](#quick-start)
  - [Prerequisites](#prerequisites)
  - [Single-Tenant (Self-Hosted)](#single-tenant-self-hosted)
  - [Multi-Tenant (SaaS)](#multi-tenant-saas)
  - [Docker Compose](#docker-compose)
- [Configuration](#configuration)
  - [Environment Variables](#environment-variables)
  - [LLM Providers](#llm-providers)
  - [Review Tuning](#review-tuning)
- [API Reference](#api-reference)
  - [Webhooks](#webhooks)
  - [OAuth](#oauth)
  - [Management API](#management-api)
  - [Health](#health)
- [Database](#database)
  - [Schema](#schema)
  - [Migrations](#migrations)
- [Authentication](#authentication)
- [Testing](#testing)
- [Deployment](#deployment)
  - [Docker](#docker)
  - [Azure Container Apps](#azure-container-apps)
- [Project Structure](#project-structure)
- [Security](#security)

---

## Architecture

```
                          Azure DevOps
                              |
                     Webhook (PR created/updated)
                              |
                              v
                    ┌─────────────────────┐
                    │   Fastify Server    │
                    │  (webhook routes)   │
                    └────────┬────────────┘
                             |
               ┌─────────────┴──────────────┐
               |                             |
          (REDIS_URL set)            (no REDIS_URL)
               |                             |
               v                             v
        ┌──────────────┐            ┌──────────────┐
        │   BullMQ     │            │  Synchronous  │
        │   Worker     │            │  (in-process) │
        └──────┬───────┘            └──────┬───────┘
               |                           |
               └───────────┬───────────────┘
                           v
                  ┌─────────────────┐
                  │   runReview()   │
                  │  (4-stage LLM)  │
                  └────────┬────────┘
                           |
              ┌────────────┼────────────┐
              v            v            v
         ADO API      Audit Store   Idempotency
        (comments)    (file/DB)      (dedup)
```

**Dual-mode operation:**

| Feature | Single-Tenant | Multi-Tenant (SaaS) |
|---------|--------------|---------------------|
| Config source | Environment variables | Database per tenant |
| ADO auth | Personal Access Token | OAuth (per-tenant tokens) |
| Webhook endpoint | `/webhooks/azure-devops/pr` | `/webhooks/ado/:tenantId` |
| API authentication | Webhook secret only | JWT (ADO JWKS) + API key |
| Storage | File-based or in-memory | PostgreSQL |
| Requires DB | No | Yes |
| Requires Redis | No (optional) | Yes (required for webhooks) |

---

## Review Pipeline

The service processes each PR through a four-stage LLM pipeline:

```
PR Webhook
  │
  ├─ 1. Fetch PR metadata + collect diff hunks
  │     ├─ Apply file/hunk limits (MAX_FILES, MAX_HUNKS, MAX_TOTAL_DIFF_LINES)
  │     └─ Filter by severity threshold (REVIEW_MIN_SEVERITY)
  │
  ├─ 2. For each hunk:
  │     ├─ LLM1 (Preprocessor): Select relevant context from surrounding code
  │     └─ LLM2 (Reviewer): Generate findings (bugs, security, style, performance)
  │
  ├─ 3. LLM3 (Accessibility, optional): Check HTML/JSX/CSS for WCAG violations
  │
  └─ 4. LLM4 (Visual Accessibility, optional): Screenshot + vision model analysis
        │
        v
  Deduplicate findings (SHA-256 hash)
  Post as inline PR comment threads
  Update PR status (succeeded/failed)
  Write audit record
```

**Finding types:** `bug`, `security`, `performance`, `style`, `accessibility`, `visual-accessibility`

**Severity levels:** `critical`, `high`, `medium`, `low`

**Strictness modes:**
- `relaxed` — Only flag clear issues
- `balanced` — Flag issues and suggest improvements (default)
- `strict` — Flag everything including style nits

---

## Quick Start

### Prerequisites

- Node.js >= 20 (`nvm use 20`)
- An Azure DevOps organization with a Personal Access Token (scope: `Code (Read & Write)`)
- An LLM provider API key (OpenAI, Anthropic, or Azure OpenAI)

### Single-Tenant (Self-Hosted)

```bash
# Install dependencies
npm ci

# Copy and configure environment
cp .env.example .env
# Edit .env with your ADO credentials and LLM provider keys

# Development mode (hot reload)
npm run dev

# Production
npm run build
npm start
```

Then configure an Azure DevOps service hook to send PR events to `POST http://<host>:3000/webhooks/azure-devops/pr` with a matching `x-webhook-secret` header.

### Multi-Tenant (SaaS)

Requires PostgreSQL and Redis:

```bash
# Copy and configure environment
cp .env.azure.example .env
# Edit .env — add DATABASE_URL, OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET,
# TOKEN_ENCRYPTION_KEY, REDIS_URL

# Generate a 32-byte encryption key (64 hex chars)
openssl rand -hex 32

# Run database migrations
npm run build
DATABASE_URL=<your-url> node dist/db/migrate.js

# Start
npm start
```

### Docker Compose

```bash
# Create a .env file with at minimum:
# POSTGRES_PASSWORD=<your-password>
# Plus your ADO + LLM provider config

docker compose up -d
```

This starts the service, PostgreSQL (localhost:5432), and Redis (localhost:6379).

---

## Configuration

### Environment Variables

#### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `LOG_LEVEL` | `info` | `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` |
| `CORS_ORIGINS` | (empty) | Comma-separated allowed origins (empty = deny all) |
| `RATE_LIMIT_MAX` | `30` | Max requests per window per IP/tenant |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window (ms) |

#### Azure DevOps

| Variable | Required | Description |
|----------|----------|-------------|
| `ADO_ORG` | Yes (single-tenant) | Organization slug |
| `ADO_PROJECT` | Yes (single-tenant) | Project name |
| `ADO_PAT` | Yes | Personal Access Token |
| `ADO_BOT_PAT` | No | Separate PAT for posting comments |
| `WEBHOOK_SECRET` | Yes (single-tenant) | Shared secret for webhook validation |

#### LLM Providers

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM1_PROVIDER` | — | Preprocessor: `mock` \| `openai` \| `azure_openai` \| `anthropic` |
| `LLM2_PROVIDER` | — | Reviewer: same options |
| `LLM3_ENABLED` | `false` | Enable text accessibility checker |
| `LLM3_PROVIDER` | — | Accessibility: same options |
| `LLM4_ENABLED` | `false` | Enable visual accessibility (requires vision model) |
| `LLM4_PROVIDER` | — | Visual a11y: `openai` or `anthropic` (vision required) |

**Provider-specific keys:**

| Provider | Variables |
|----------|-----------|
| OpenAI | `OPENAI_API_KEY`, `OPENAI_MODEL_LLM1`, `OPENAI_MODEL_LLM2`, `OPENAI_MODEL_LLM3`, `OPENAI_MODEL_LLM4` |
| Azure OpenAI | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT_LLM1`, `AZURE_OPENAI_DEPLOYMENT_LLM2`, `AZURE_OPENAI_DEPLOYMENT_LLM3` |
| Anthropic | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL_LLM1`, `ANTHROPIC_MODEL_LLM2`, `ANTHROPIC_MODEL_LLM3`, `ANTHROPIC_MODEL_LLM4` |

#### Review Tuning

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_FILES` | `20` | Max files per PR review |
| `MAX_TOTAL_DIFF_LINES` | `2000` | Max total diff lines |
| `MAX_HUNKS` | `80` | Max diff hunks to process |
| `HUNK_CONTEXT_LINES` | `20` | Lines of context around changes |
| `TOKEN_BUDGET_LLM1` | `3000` | Preprocessor token budget |
| `TOKEN_BUDGET_LLM2` | `6000` | Reviewer token budget |
| `TOKEN_BUDGET_LLM3` | `4000` | Accessibility checker budget |
| `TOKEN_BUDGET_LLM4` | `8000` | Visual accessibility budget |
| `REVIEW_MIN_SEVERITY` | `low` | Minimum severity to report: `low` \| `medium` \| `high` \| `critical` |
| `REVIEW_STRICTNESS` | `balanced` | Review strictness: `relaxed` \| `balanced` \| `strict` |
| `A11Y_FILE_EXTENSIONS` | `.html,.jsx,.tsx,.vue,.svelte,.css,.scss` | File extensions for a11y checks |
| `AUDIT_ENABLED` | `true` | Enable audit logging |
| `AUDIT_RETENTION_DAYS` | `30` | Audit log retention period |

#### Queue (Optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | (empty) | Redis connection string. Empty = synchronous processing |

#### Multi-Tenant Mode (SaaS)

These are only required when `DATABASE_URL` is set:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `DEPLOYMENT_MODE` | No (`saas`) | `saas` \| `self-hosted` |
| `OAUTH_CLIENT_ID` | Yes (SaaS) | Azure DevOps OAuth app ID |
| `OAUTH_CLIENT_SECRET` | Yes (SaaS) | Azure DevOps OAuth app secret |
| `OAUTH_REDIRECT_URI` | Yes (SaaS) | OAuth callback URL |
| `TOKEN_ENCRYPTION_KEY` | Yes (SaaS) | 64-char hex string (32 bytes) for AES-256-GCM. Generate with `openssl rand -hex 32` |

### LLM Providers

Each stage of the pipeline can use a different LLM provider:

| Stage | Purpose | Vision Required | Recommended Model |
|-------|---------|-----------------|-------------------|
| LLM1 | Context selection (preprocessor) | No | `gpt-4o-mini` or `claude-haiku-4-5-20251001` |
| LLM2 | Code review (reviewer) | No | `gpt-4o` or `claude-sonnet-4-6` |
| LLM3 | Accessibility audit | No | `gpt-4o` or `claude-sonnet-4-6` |
| LLM4 | Visual accessibility (screenshots) | **Yes** | `gpt-4o` or `claude-sonnet-4-6` |

---

## API Reference

### Webhooks

#### `POST /webhooks/azure-devops/pr` (Single-Tenant)

Receives Azure DevOps pull request webhook events.

**Headers:**
- `x-webhook-secret` (required): Must match `WEBHOOK_SECRET`

**Body:** Standard ADO webhook payload (supports both `pullRequestId` and `resource.pullRequestId` formats).

**Optional fields:**
- `previewUrl` (string, valid URL): Page URL for visual accessibility screenshots

**Response:** `200 { ok: true }`

#### `POST /webhooks/ado/:tenantId` (Multi-Tenant)

**Path params:**
- `tenantId` (UUID): Tenant identifier

**Headers (one required):**
- `Authorization: Basic <base64(user:secret)>` — Basic auth with webhook secret as password
- `x-webhook-secret` — Webhook secret header

**Body:** Same as single-tenant endpoint.

**Response:** `202 { ok: true }`

### OAuth

#### `GET /auth/ado/authorize`

Redirects to Azure DevOps OAuth authorization page.

#### `GET /auth/ado/callback?code=...&state=...`

Handles the OAuth callback, exchanges the code for tokens, creates/updates the tenant, and redirects to `OAUTH_REDIRECT_URI`.

#### `DELETE /auth/ado/connection/:tenantId`

Revokes OAuth tokens for a tenant. **Requires authentication** — the caller must be the tenant owner (JWT `tenantId` must match path param).

### Management API

All `/api/*` routes require `Authorization: Bearer <JWT>` header. The JWT is verified against Azure DevOps JWKS. The tenant is resolved from the JWT `aud` claim.

#### Tenants

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/tenants/me` | Get current tenant info |

#### Projects

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects` | List enrolled projects |
| `POST` | `/api/projects/:id/enable` | Enable project + create webhook subscription |
| `POST` | `/api/projects/:id/disable` | Disable project + remove webhook |

#### Reviews

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/reviews` | List reviews (paginated). Query: `page`, `limit` (1-100), `projectId` |
| `GET` | `/api/reviews/:id` | Get review details with findings |
| `POST` | `/api/reviews/:id/retrigger` | Re-enqueue a review |

#### Config

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/config` | Get tenant review configuration |
| `PUT` | `/api/config` | Update tenant review configuration |

### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness check. Returns `200 { status: "ok" }` |
| `GET` | `/ready` | Readiness check. Returns `503` if Redis queue is unreachable |

---

## Database

### Schema

The multi-tenant mode uses PostgreSQL with Drizzle ORM. Six tables:

| Table | Description |
|-------|-------------|
| `tenants` | Tenant records (org ID, status, plan) |
| `tenant_oauth_tokens` | Encrypted OAuth tokens per tenant |
| `tenant_configs` | Per-tenant review configuration overrides |
| `project_enrollments` | ADO projects enrolled for review (with encrypted webhook secrets) |
| `reviews` | Review execution records (status, timings, metadata) |
| `review_findings` | Individual findings per review (severity, file, line, message, hash) |

All sensitive data (tokens, API keys, webhook secrets) is encrypted at rest with AES-256-GCM.

### Migrations

```bash
# Generate a new migration after schema changes
npx drizzle-kit generate

# Run pending migrations
node dist/db/migrate.js
# Or: DATABASE_URL=... npx tsx src/db/migrate.ts
```

Migrations run automatically on server startup when `DATABASE_URL` is set.

---

## Authentication

### Single-Tenant Mode

Webhooks are authenticated using a shared secret (`WEBHOOK_SECRET`) validated with constant-time comparison.

### Multi-Tenant SaaS Mode

**Webhook authentication:** Per-project webhook secrets stored encrypted in the database. Validated via `Authorization: Basic` header or `x-webhook-secret`.

**API authentication (adoAuth middleware):**
1. **SaaS mode:** JWT signature verified against the [Azure DevOps JWKS endpoint](https://app.vstoken.visualstudio.com/_apis/Token/SessionTokens) using the `jose` library. Requires valid signature, `exp` claim, and matching tenant in the database.
2. **Self-hosted mode:** Bearer token compared against `ADO_PAT` with `crypto.timingSafeEqual`. Falls back to JWT verification if the API key doesn't match.

**OAuth token lifecycle:**
- Tokens encrypted with AES-256-GCM before storage
- Background refresh job runs every 10 minutes
- Tokens refreshed when within 5 minutes of expiry
- Failed refresh after 3 retries marks tenant as `needs_reauth`

---

## Testing

```bash
# Run all tests
npm test

# Run with coverage (80% threshold)
npm run test:coverage

# Run specific test file
npx vitest run test/middleware/adoAuth.test.ts

# Watch mode
npx vitest
```

**Test structure:**
- Unit tests for all modules (LLM stages, config, severity, diff collection)
- Integration tests for database repos, auth middleware, routes (require PostgreSQL, skipped automatically when `DATABASE_URL` is absent)
- E2E test for the full review pipeline (mock LLM providers)

**Current:** 235 tests passing, 103 DB-dependent tests auto-skipped without PostgreSQL.

---

## Deployment

### Docker

```bash
# Build
docker build -t llm-review-service .

# Run
docker run -p 3000:3000 --env-file .env llm-review-service
```

The Dockerfile uses a multi-stage build:
1. **Build stage:** `node:20.19-slim` — installs deps, compiles TypeScript
2. **Runtime stage:** `node:20.19-slim` — production deps only, non-root user (`appuser`), copies `dist/` and migrations

### Azure Container Apps

The project includes an Azure Pipelines CI/CD configuration (`azure-pipelines.yml`) with three stages:

1. **Build & Test:** lint, typecheck, build, test with coverage
2. **Docker Build & Push:** Builds and pushes to Azure Container Registry (`acrcodereview.azurecr.io`)
3. **Deploy:** Updates the Azure Container App (`ca-llm-review`)

Infrastructure provisioning script: `infra/setup.sh` (creates resource group, ACR, PostgreSQL, Container Apps environment).

---

## Project Structure

```
src/
├── server.ts                 # Entry point, startup, graceful shutdown
├── app.ts                    # Fastify app builder, route registration
├── config.ts                 # Legacy single-tenant config (Zod schema)
├── logger.ts                 # Pino logger factory
│
├── config/
│   ├── appConfig.ts          # Multi-tenant app config (Zod schema)
│   └── tenantConfig.ts       # Per-tenant config types
│
├── auth/
│   ├── encryption.ts         # AES-256-GCM encrypt/decrypt + key derivation
│   └── tokenManager.ts       # OAuth token store, refresh, revoke
│
├── azure/
│   ├── adoClient.ts          # Azure DevOps REST client (OAuth + PAT auth)
│   ├── adoTypes.ts           # ADO type definitions
│   └── threadBuilder.ts      # Converts findings to PR comment threads
│
├── context/
│   └── tenantContext.ts      # Builds per-request tenant context
│
├── db/
│   ├── connection.ts         # PostgreSQL pool management
│   ├── migrate.ts            # Migration runner (CLI + programmatic)
│   ├── schema.ts             # Drizzle table definitions
│   ├── migrations/           # SQL migration files
│   └── repos/                # Data access layer
│       ├── tenantRepo.ts
│       ├── configRepo.ts
│       ├── projectRepo.ts
│       └── reviewRepo.ts
│
├── llm/
│   ├── types.ts              # LLMClient interface + provider factory
│   ├── reviewer.ts           # Code review stage (LLM2)
│   ├── preprocessor.ts       # Context selection stage (LLM1)
│   ├── accessibilityChecker.ts    # Text a11y stage (LLM3)
│   ├── visualAccessibilityChecker.ts  # Visual a11y stage (LLM4)
│   ├── screenshotCapture.ts  # Playwright screenshot capture
│   ├── prompts/              # LLM prompt templates
│   └── providers/            # Provider implementations
│       ├── mockProvider.ts
│       ├── openaiResponsesProvider.ts
│       ├── azureOpenAIProvider.ts
│       └── anthropicProvider.ts
│
├── middleware/
│   ├── adoAuth.ts            # JWT/API key authentication
│   └── rateLimiter.ts        # Per-tenant rate limiting
│
├── review/
│   ├── runReview.ts          # Main review orchestration pipeline
│   ├── queue.ts              # BullMQ queue + worker
│   ├── audit.ts              # Audit store (file, DB, in-memory)
│   ├── idempotency.ts        # Finding deduplication store
│   ├── diffCollector.ts      # Diff hunk extraction
│   ├── severity.ts           # Severity filtering
│   ├── limits.ts             # Config-based review limits
│   └── hunkTypes.ts          # DiffHunk type definitions
│
├── routes/
│   ├── webhooks.ts           # Webhook endpoints (legacy + multi-tenant)
│   ├── auth.ts               # OAuth flow routes
│   ├── health.ts             # Health check endpoints
│   └── api/                  # Management API (JWT-protected)
│       ├── index.ts
│       ├── tenants.ts
│       ├── projects.ts
│       ├── reviews.ts
│       └── config.ts
│
└── jobs/
    └── tokenRefresh.ts       # Background OAuth token refresh
```

---

## Security

- **JWT verification:** All API requests verified against ADO JWKS endpoint using `jose.jwtVerify()`
- **Constant-time comparison:** Webhook secrets and API keys compared with `crypto.timingSafeEqual`
- **Encryption at rest:** OAuth tokens, API keys, and webhook secrets encrypted with AES-256-GCM (random 12-byte IV, 16-byte auth tag)
- **Key derivation:** `TOKEN_ENCRYPTION_KEY` must be a 64-character hex string (32 bytes). Centralized `deriveEncryptionKey()` utility used consistently across all code paths
- **SQL injection prevention:** Drizzle ORM with parameterized queries throughout
- **Input validation:** Zod schemas on all webhook payloads, API inputs, config values, and pagination parameters
- **Rate limiting:** Per-tenant rate limiting via `@fastify/rate-limit`
- **Anti-enumeration:** Webhook and auth endpoints return uniform `401` responses regardless of whether tenant exists or secret is wrong
- **Tenant isolation:** All database queries scoped by `tenantId`; project repo update restricted to safe fields only
- **Non-root container:** Docker image runs as `appuser` (UID 1001)
- **Localhost-only ports:** PostgreSQL and Redis bound to `127.0.0.1` in docker-compose
- **No secrets in source:** All credentials via environment variables; `.env` files in `.gitignore`
