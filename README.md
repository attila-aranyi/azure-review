# llm-review-service

AI-powered code review for Azure DevOps pull requests using a multi-stage LLM pipeline.

The service receives webhook events from Azure DevOps, collects PR diffs, runs them through up to four LLM stages (context preprocessing, code review, accessibility audit, visual accessibility audit), and posts findings back as inline PR threads.

## Architecture Overview

```
Azure DevOps PR
       │
       ▼
  POST /webhooks/azure-devops/pr
       │
       ├──► Collect diffs from ADO REST API
       │
       ├──► LLM1 — Context Preprocessor (per hunk)
       │        Selects minimal useful context for the reviewer
       │
       ├──► LLM2 — Code Reviewer (per hunk)
       │        Full code review → findings
       │
       ├──► LLM3 — Accessibility Checker (per hunk, optional)
       │        WCAG 2.1 text-based audit on diff hunks
       │
       ├──► LLM4 — Visual Accessibility (once per review, optional)
       │        Playwright screenshots + vision LLM → visual a11y findings
       │
       ├──► Severity filter + idempotency dedup
       │
       └──► Post findings as inline PR threads back to Azure DevOps
```

Each stage can use a different LLM provider. LLM3 and LLM4 are independently opt-in.

## Features

- **Multi-stage LLM pipeline** — preprocessor → reviewer → accessibility → visual accessibility
- **Multiple LLM providers** — OpenAI, Azure OpenAI, Anthropic, or mock (for testing)
- **Mix-and-match providers** — use a different provider/model per stage
- **9 issue types** — bug, security, performance, style, correctness, maintainability, testing, docs, accessibility
- **4 severity levels** — low, medium, high, critical (configurable minimum threshold)
- **3 strictness modes** — relaxed, balanced, strict
- **Text accessibility audit (LLM3)** — WCAG 2.1 checks on diff hunks, file extension filter
- **Visual accessibility audit (LLM4)** — Playwright screenshots analyzed by vision LLM (10 WCAG categories)
- **Idempotent posting** — SHA-256 finding hashes prevent duplicate PR comments
- **Audit trail** — JSONL log of every review with timings, findings, and statuses
- **Queue mode** — optional Redis/BullMQ for async processing with retries
- **Rate limiting** — per-IP limits on the webhook endpoint
- **CORS support** — configurable allowed origins
- **Health checks** — `/health` (liveness) and `/ready` (readiness with Redis check)
- **Docker & docker-compose** — production-ready container with Redis sidecar
- **Azure Container Apps deployment** — infrastructure script + CI/CD pipeline

## Prerequisites

**Required:**

- Node.js 20+
- An Azure DevOps Personal Access Token (PAT) with **Code: Read & Write** scope
- At least one LLM API key (OpenAI, Azure OpenAI, or Anthropic) — or use `mock` for testing

**Optional:**

- Redis 7+ (for queue mode)
- Playwright (`npm install playwright`) + Chromium (for LLM4 visual accessibility)
- Docker & Docker Compose (for containerized deployment)
- Azure CLI (for Azure Container Apps deployment)

## Quick Start

```bash
# 1. Clone and enter the service directory
cd llm-review-service

# 2. Install dependencies
npm install

# 3. Create your .env from the example
cp .env.example .env

# 4. Edit .env — set at minimum:
#    WEBHOOK_SECRET, ADO_ORG, ADO_PROJECT, ADO_PAT
#    LLM1_PROVIDER, LLM2_PROVIDER + provider-specific keys/models

# 5. Start the dev server
npm run dev
```

Smoke test (with mock providers):

```bash
curl -X POST http://localhost:3000/webhooks/azure-devops/pr \
  -H "content-type: application/json" \
  -H "x-webhook-secret: <your-WEBHOOK_SECRET>" \
  -d '{"resource":{"pullRequestId":1,"repository":{"id":"your-repo-id"}}}'
```

Expected response: `{"ok":true}`

## Configuration Reference

All environment variables are validated at startup via Zod (`src/config.ts`). The service will refuse to start if required variables are missing.

### Server & Security

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | HTTP listen port |
| `WEBHOOK_SECRET` | **Yes** | — | Shared secret checked via `x-webhook-secret` header (timing-safe comparison) |
| `CORS_ORIGINS` | No | `""` (deny all) | Comma-separated allowed origins |
| `RATE_LIMIT_MAX` | No | `30` | Max requests per IP per window |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` | Rate limit window in milliseconds |

### Azure DevOps

| Variable | Required | Default | Description |
|---|---|---|---|
| `ADO_ORG` | **Yes** | — | Azure DevOps organization name |
| `ADO_PROJECT` | **Yes** | — | Azure DevOps project name |
| `ADO_PAT` | **Yes** | — | Personal Access Token (Code: Read & Write) |

### LLM Providers

| Variable | Required | Default | Description |
|---|---|---|---|
| `LLM1_PROVIDER` | **Yes** | — | Provider for stage 1: `mock`, `openai`, `azure_openai`, `anthropic` |
| `LLM2_PROVIDER` | **Yes** | — | Provider for stage 2: `mock`, `openai`, `azure_openai`, `anthropic` |
| `LLM3_ENABLED` | No | `false` | Enable text accessibility checker |
| `LLM3_PROVIDER` | If LLM3 enabled | — | Provider for stage 3: `mock`, `openai`, `azure_openai`, `anthropic` |
| `LLM4_ENABLED` | No | `false` | Enable visual accessibility checker |
| `LLM4_PROVIDER` | If LLM4 enabled | — | Provider for stage 4: `mock`, `openai`, `anthropic` (**not** `azure_openai`) |

### OpenAI

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENAI_API_KEY` | If any stage uses `openai` | — | OpenAI API key |
| `OPENAI_MODEL_LLM1` | If LLM1 uses `openai` | — | Model for stage 1 (e.g. `gpt-4o`) |
| `OPENAI_MODEL_LLM2` | If LLM2 uses `openai` | — | Model for stage 2 |
| `OPENAI_MODEL_LLM3` | If LLM3 uses `openai` | — | Model for stage 3 |
| `OPENAI_MODEL_LLM4` | If LLM4 uses `openai` | — | Model for stage 4 (must support vision) |

### Azure OpenAI

| Variable | Required | Default | Description |
|---|---|---|---|
| `AZURE_OPENAI_ENDPOINT` | If any stage uses `azure_openai` | — | Endpoint URL (e.g. `https://my-resource.openai.azure.com`) |
| `AZURE_OPENAI_API_KEY` | If any stage uses `azure_openai` | — | Azure OpenAI API key |
| `AZURE_OPENAI_DEPLOYMENT_LLM1` | If LLM1 uses `azure_openai` | — | Deployment name for stage 1 |
| `AZURE_OPENAI_DEPLOYMENT_LLM2` | If LLM2 uses `azure_openai` | — | Deployment name for stage 2 |
| `AZURE_OPENAI_DEPLOYMENT_LLM3` | If LLM3 uses `azure_openai` | — | Deployment name for stage 3 |

> **Note:** Azure OpenAI cannot be used for LLM4 — it does not support the vision API required for screenshot analysis. Use `openai` or `anthropic` for LLM4.

### Anthropic

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | If any stage uses `anthropic` | — | Anthropic API key |
| `ANTHROPIC_MODEL_LLM1` | If LLM1 uses `anthropic` | — | Model for stage 1 (e.g. `claude-sonnet-4-6`) |
| `ANTHROPIC_MODEL_LLM2` | If LLM2 uses `anthropic` | — | Model for stage 2 |
| `ANTHROPIC_MODEL_LLM3` | If LLM3 uses `anthropic` | — | Model for stage 3 |
| `ANTHROPIC_MODEL_LLM4` | If LLM4 uses `anthropic` | — | Model for stage 4 (supports vision natively) |

### Diff & Review Limits

| Variable | Required | Default | Description |
|---|---|---|---|
| `MAX_FILES` | No | `20` | Max files to process per PR |
| `MAX_TOTAL_DIFF_LINES` | No | `2000` | Max total diff lines across all files |
| `MAX_HUNKS` | No | `80` | Max diff hunks to process |
| `HUNK_CONTEXT_LINES` | No | `20` | Lines of surrounding context per hunk |

### Token Budgets

| Variable | Required | Default | Description |
|---|---|---|---|
| `TOKEN_BUDGET_LLM1` | No | `3000` | Max output tokens for preprocessor |
| `TOKEN_BUDGET_LLM2` | No | `6000` | Max output tokens for reviewer |
| `TOKEN_BUDGET_LLM3` | No | `4000` | Max output tokens for accessibility checker |
| `TOKEN_BUDGET_LLM4` | No | `8000` | Max output tokens for visual accessibility |

### Accessibility (LLM3)

| Variable | Required | Default | Description |
|---|---|---|---|
| `A11Y_FILE_EXTENSIONS` | No | `.html,.jsx,.tsx,.vue,.svelte,.css,.scss` | Comma-separated file extensions to run LLM3 on |

### Visual Accessibility (LLM4)

| Variable | Required | Default | Description |
|---|---|---|---|
| `VISUAL_A11Y_VIEWPORT_WIDTH` | No | `1280` | Browser viewport width for screenshots |
| `VISUAL_A11Y_VIEWPORT_HEIGHT` | No | `900` | Browser viewport height for screenshots |
| `VISUAL_A11Y_PAGES` | No | `/` | Comma-separated page paths to screenshot (relative to `previewUrl`) |
| `VISUAL_A11Y_WAIT_MS` | No | `3000` | Wait time after page load before screenshot (ms) |
| `VISUAL_A11Y_MAX_SCREENSHOTS` | No | `5` | Max number of pages to screenshot |

### Queue (Redis)

| Variable | Required | Default | Description |
|---|---|---|---|
| `REDIS_URL` | No | — | Redis connection URL. If set, enables async queue mode (e.g. `redis://localhost:6379`) |

### Audit Trail

| Variable | Required | Default | Description |
|---|---|---|---|
| `AUDIT_ENABLED` | No | `true` | Enable audit logging |
| `AUDIT_RETENTION_DAYS` | No | `30` | Days to retain audit records before pruning |

### Review Behavior

| Variable | Required | Default | Description |
|---|---|---|---|
| `REVIEW_MIN_SEVERITY` | No | `low` | Minimum severity to post: `low`, `medium`, `high`, `critical` |
| `REVIEW_STRICTNESS` | No | `balanced` | Review strictness mode: `relaxed`, `balanced`, `strict` |

### Logging

| Variable | Required | Default | Description |
|---|---|---|---|
| `LOG_LEVEL` | No | `info` | Pino log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal` |

## LLM Providers

| Provider | ID | API | Vision Support | Required Env Vars |
|---|---|---|---|---|
| OpenAI | `openai` | Responses API | Yes (GPT-4o, etc.) | `OPENAI_API_KEY`, `OPENAI_MODEL_LLM*` |
| Azure OpenAI | `azure_openai` | Chat Completions | No (LLM1-3 only) | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT_LLM*` |
| Anthropic | `anthropic` | Messages API | Yes (Claude models) | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL_LLM*` |
| Mock | `mock` | None | N/A | None |

**Example: Anthropic for all stages**

```env
LLM1_PROVIDER=anthropic
LLM2_PROVIDER=anthropic
LLM3_ENABLED=true
LLM3_PROVIDER=anthropic
LLM4_ENABLED=true
LLM4_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL_LLM1=claude-sonnet-4-6
ANTHROPIC_MODEL_LLM2=claude-sonnet-4-6
ANTHROPIC_MODEL_LLM3=claude-sonnet-4-6
ANTHROPIC_MODEL_LLM4=claude-sonnet-4-6
```

**Example: Azure OpenAI for LLM1-2, OpenAI for LLM4**

```env
LLM1_PROVIDER=azure_openai
LLM2_PROVIDER=azure_openai
LLM4_ENABLED=true
LLM4_PROVIDER=openai
AZURE_OPENAI_ENDPOINT=https://my-resource.openai.azure.com
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_DEPLOYMENT_LLM1=gpt-4o
AZURE_OPENAI_DEPLOYMENT_LLM2=gpt-4o
OPENAI_API_KEY=sk-...
OPENAI_MODEL_LLM4=gpt-4o
```

## Pipeline Stages

### LLM1 — Context Preprocessor

Runs once per diff hunk. Receives the hunk text, local file context, and any candidate context snippets. Selects the minimal useful context for the reviewer within a token budget.

- **Input:** hunk text, surrounding file context, token budget
- **Output:** selected context snippets with reasoning
- **Purpose:** Prevents sending large irrelevant context to the reviewer

### LLM2 — Code Reviewer

Runs once per diff hunk with the preprocessed context. Performs a full code review and returns structured findings.

- **Issue types:** `bug`, `security`, `performance`, `style`, `correctness`, `maintainability`, `testing`, `docs`, `accessibility`
- **Severity levels:** `low`, `medium`, `high`, `critical`
- **Strictness modes:**
  - `relaxed` — only flags clear bugs, security vulnerabilities, and critical issues
  - `balanced` — default behavior, flags actionable issues
  - `strict` — flags all potential issues including style, naming, and subtle bugs
- **Output:** array of findings with file path, line range, message, and optional suggestion

### LLM3 — Accessibility Checker (optional)

Runs once per diff hunk, only on files matching `A11Y_FILE_EXTENSIONS`. Performs a WCAG 2.1 text-based accessibility audit on the diff.

- **Enable:** `LLM3_ENABLED=true` + `LLM3_PROVIDER=...`
- **Checks:** missing alt text, ARIA attributes, semantic HTML, keyboard navigation, color contrast, form labels, focus management, screen reader compatibility
- **Strictness modes:**
  - `relaxed` — WCAG 2.1 Level A only
  - `balanced` — Level A + AA
  - `strict` — Level A + AA + AAA
- **File filter:** only runs on hunks in files ending with one of `A11Y_FILE_EXTENSIONS`

### LLM4 — Visual Accessibility (optional)

Runs once per review (not per hunk). Uses Playwright to capture full-page screenshots of a preview deployment, then sends them to a vision-capable LLM for analysis.

- **Enable:** `LLM4_ENABLED=true` + `LLM4_PROVIDER=openai|anthropic` (not `azure_openai`)
- **Requires:** `previewUrl` field in the webhook payload + Playwright installed
- **WCAG categories checked** (10 total):
  1. Color Contrast (1.4.3, 1.4.6)
  2. Focus Indicators (2.4.7)
  3. Text Sizing & Readability (1.4.4)
  4. Touch Target Size (2.5.5)
  5. Layout & Reflow (1.4.10)
  6. Visual Labels (1.3.5, 3.3.2)
  7. Color-Only Information (1.4.1)
  8. Motion & Animation (2.3.1)
  9. Consistent Navigation (3.2.3)
  10. Error Identification (3.3.1)
- **Configuration:** viewport size, page paths, wait time, max screenshots (see [Visual Accessibility env vars](#visual-accessibility-llm4))

## Webhook Integration

### Endpoint

```
POST /webhooks/azure-devops/pr
```

### Authentication

Include the shared secret in the `x-webhook-secret` header:

```
x-webhook-secret: <your-WEBHOOK_SECRET>
```

The secret is compared using a timing-safe comparison. Returns `401` on mismatch.

### Payload

The endpoint accepts two payload shapes:

**Flat format:**

```json
{
  "pullRequestId": 123,
  "repository": { "id": "repo-guid" },
  "previewUrl": "https://preview.example.com"
}
```

**Nested Azure DevOps Service Hook format:**

```json
{
  "resource": {
    "pullRequestId": 123,
    "repository": { "id": "repo-guid" }
  },
  "previewUrl": "https://preview.example.com"
}
```

The `previewUrl` field is optional. When provided and LLM4 is enabled, visual accessibility screenshots will be captured from this URL.

### Curl examples

**Basic trigger:**

```bash
curl -X POST http://localhost:3000/webhooks/azure-devops/pr \
  -H "content-type: application/json" \
  -H "x-webhook-secret: replace-me" \
  -d '{"resource":{"pullRequestId":1,"repository":{"id":"REPO_ID"}}}'
```

**With preview URL for LLM4:**

```bash
curl -X POST http://localhost:3000/webhooks/azure-devops/pr \
  -H "content-type: application/json" \
  -H "x-webhook-secret: replace-me" \
  -d '{
    "resource": {"pullRequestId": 1, "repository": {"id": "REPO_ID"}},
    "previewUrl": "https://preview-pr-1.example.com"
  }'
```

## Azure DevOps Service Hook Setup

1. **Expose your local server** (for development):
   - ngrok: `ngrok http 3000`
   - cloudflared: `cloudflared tunnel --url http://localhost:3000`

2. In Azure DevOps, go to **Project Settings** → **Service hooks** → **Create subscription**

3. Select **Web Hooks** as the service

4. Choose trigger event(s):
   - **Pull request created**
   - **Pull request updated**

5. Configure the action:
   - **URL:** `https://<your-host>/webhooks/azure-devops/pr`
   - **HTTP headers:** `x-webhook-secret:<your-WEBHOOK_SECRET>`

6. Click **Test** to send a test event, then **Finish**

## Calling from an Azure Pipeline

You can trigger a review from a pipeline task, for example after deploying a preview environment. This lets you pass a `previewUrl` for LLM4 visual accessibility checks.

```yaml
# Example: Trigger LLM review after deploying a preview
- task: Bash@3
  displayName: "Trigger LLM Code Review"
  inputs:
    targetType: inline
    script: |
      curl -sf -X POST "$(LLM_REVIEW_URL)/webhooks/azure-devops/pr" \
        -H "content-type: application/json" \
        -H "x-webhook-secret: $(WEBHOOK_SECRET)" \
        -d '{
          "pullRequestId": $(System.PullRequest.PullRequestId),
          "repository": { "id": "$(Build.Repository.ID)" },
          "previewUrl": "$(PREVIEW_URL)"
        }'
  env:
    LLM_REVIEW_URL: $(LLM_REVIEW_URL)
    WEBHOOK_SECRET: $(WEBHOOK_SECRET)
    PREVIEW_URL: $(PREVIEW_URL)
```

**Pipeline variables to set:**

| Variable | Description |
|---|---|
| `LLM_REVIEW_URL` | Base URL of your deployed llm-review-service (e.g. `https://ca-llm-review.example.azurecontainerapps.io`) |
| `WEBHOOK_SECRET` | Same value as the service's `WEBHOOK_SECRET` env var (store as a secret variable) |
| `PREVIEW_URL` | URL of the preview deployment for this PR (optional, needed for LLM4) |

## Deployment Options

### Local Development

```bash
npm install
npm run dev
```

The server starts with hot-reload via `tsx watch` on `http://localhost:3000`.

### Docker & docker-compose

The included `docker-compose.yml` starts the service and a Redis sidecar:

```bash
# Build and start both containers
docker compose up --build
```

This starts:
- **llm-review-service** on port `${PORT:-3000}` with health checks
- **Redis 7** on port `6379` with health checks

The service container waits for Redis to be healthy before starting.

**Standalone Docker build** (without Redis):

```bash
docker build -t llm-review-service .
docker run --rm -p 3000:3000 --env-file .env llm-review-service
```

The Dockerfile uses a multi-stage build: compiles TypeScript in a `node:20-slim` build stage, then copies the output to a production image with only production dependencies. Runs as a non-root user (`appuser`).

### Azure Container Apps

For production deployment to Azure Container Apps:

**1. Prepare the environment file:**

```bash
cp .env.azure.example .env.azure
# Edit .env.azure with your secrets and configuration
```

**2. Run the infrastructure setup script:**

```bash
az login
bash infra/setup.sh
```

**What `infra/setup.sh` creates:**

| Resource | Name | Description |
|---|---|---|
| Resource Group | `rg-code-review` | Contains all resources |
| Azure Container Registry | `acrcodereview` | Stores Docker images |
| Container Apps Environment | `cae-code-review` | Hosting environment |
| Container App | `ca-llm-review` | The running service with managed identity |

The script:
- Sources all variables from `.env.azure`
- Validates required secrets (`WEBHOOK_SECRET`, `ADO_ORG`, `ADO_PROJECT`, `ADO_PAT`, `ANTHROPIC_API_KEY`, etc.)
- Creates the Container App with secrets stored securely (via `secretref:`)
- Assigns the `AcrPull` role to the Container App's managed identity
- Outputs the FQDN, health check URL, and webhook URL

**3. CI/CD pipeline (`azure-pipelines.yml`):**

The included pipeline has 3 stages:

| Stage | Trigger | Description |
|---|---|---|
| **Build & Test** | All pushes | `npm ci` → lint → typecheck → build → test with coverage |
| **Docker Build & Push** | Main branch only | Builds Docker image, pushes to ACR with `BuildId` and `latest` tags |
| **Deploy** | After Docker push | Updates the Container App image to the new `BuildId` tag |

Pipeline variables to configure in Azure DevOps:

| Variable | Description |
|---|---|
| `azureSubscription` | Azure Resource Manager service connection name |
| `acrName` | ACR name (default: `acrcodereview`) |
| `resourceGroup` | Resource group (default: `rg-code-review`) |
| `containerAppName` | Container App name (default: `ca-llm-review`) |

## Health Checks

| Endpoint | Purpose | Behavior |
|---|---|---|
| `GET /health` | Liveness probe | Always returns `{"status":"ok"}` (200) |
| `GET /ready` | Readiness probe | Returns `{"status":"ready"}` (200). If Redis is configured, pings Redis first — returns 503 if unreachable |

**Container Apps / Kubernetes probe config example:**

```yaml
probes:
  - type: liveness
    httpGet:
      path: /health
      port: 3000
    initialDelaySeconds: 10
    periodSeconds: 10
  - type: readiness
    httpGet:
      path: /ready
      port: 3000
    initialDelaySeconds: 5
    periodSeconds: 5
```

## Queue Mode (Redis)

When `REDIS_URL` is set, the webhook immediately enqueues a BullMQ job and returns `{"ok":true}`. A worker in the same process picks up the job and runs the review pipeline.

**Benefits:**
- Webhook responds instantly (no timeout risk for large PRs)
- Automatic retries: 3 attempts with exponential backoff (1s, 2s, 4s)
- Failed jobs are retained (last 100) for debugging
- Completed jobs are removed automatically

**Local Redis for development:**

```bash
docker run --rm -p 6379:6379 redis:7
```

```env
REDIS_URL=redis://localhost:6379
```

Without `REDIS_URL`, the review runs synchronously via `setImmediate` after the webhook responds (with a 2-minute timeout).

## Audit Trail

When `AUDIT_ENABLED=true` (the default), every review is logged to `.data/audit.jsonl`.

**Each audit record contains:**

- Review ID and request ID
- Repository ID, PR ID, source/target commits
- List of changed files
- Number of hunks processed
- Per-hunk results: provider, model, timing (ms), finding count for each LLM stage
- All findings with their status:
  - `posted` — published to Azure DevOps as a PR thread
  - `skipped_duplicate` — already posted (idempotency dedup)
  - `filtered` — below minimum severity threshold
- Timing breakdown: total, fetch PR, list changes, collect diffs (all in ms)
- Review status: `success` or `failure` (with error message)
- Timestamps: started at, completed at

**Retention:** expired records are pruned every 6 hours. Default retention is 30 days (configurable via `AUDIT_RETENTION_DAYS`).

If the file audit store is unavailable (e.g. read-only filesystem), it falls back to an in-memory store.

## Severity Filtering

`REVIEW_MIN_SEVERITY` controls which findings are posted to Azure DevOps. Findings below the threshold are recorded in the audit trail as `filtered` but not posted.

| `REVIEW_MIN_SEVERITY` | Posts `low` | Posts `medium` | Posts `high` | Posts `critical` |
|---|---|---|---|---|
| `low` (default) | Yes | Yes | Yes | Yes |
| `medium` | No | Yes | Yes | Yes |
| `high` | No | No | Yes | Yes |
| `critical` | No | No | No | Yes |

## Review Strictness

`REVIEW_STRICTNESS` controls how aggressive the LLM reviewers are. Affects both LLM2 (code review) and LLM3 (accessibility).

| Mode | LLM2 Behavior | LLM3 Behavior |
|---|---|---|
| `relaxed` | Only flags clear bugs, security vulnerabilities, and critical issues. Ignores style and subjective concerns. | WCAG 2.1 Level A violations only |
| `balanced` (default) | Flags actionable and specific issues across all categories | WCAG 2.1 Level A + AA |
| `strict` | Flags all potential issues including style, naming, maintainability, and subtle bugs | WCAG 2.1 Level A + AA + AAA |

## Idempotency

Findings are deduplicated using a SHA-256 hash of `issueType + severity + filePath + startLine + endLine + message + suggestion`. The hash is scoped to `repoId + prId + iteration` (commit SHA).

- **Storage:** `.data/idempotency.json` (falls back to in-memory if file is unavailable)
- **Expiry:** entries older than 30 days are pruned automatically (every 6 hours)
- **Effect:** if the same finding was already posted for the same PR iteration, it is silently skipped

This prevents duplicate comments when a webhook fires multiple times for the same PR update.

## npm Scripts

| Script | Command | Description |
|---|---|---|
| `dev` | `tsx watch src/server.ts` | Start dev server with hot reload |
| `build` | `tsc -p tsconfig.json` | Compile TypeScript to `dist/` |
| `start` | `node dist/server.js` | Start production server |
| `lint` | `eslint . --ext .ts` | Run ESLint |
| `typecheck` | `tsc --noEmit` | Type-check without emitting |
| `test` | `vitest run` | Run tests once |
| `test:coverage` | `vitest run --coverage` | Run tests with V8 coverage |

## Troubleshooting

**401/403 from Azure DevOps**
Verify `ADO_ORG`, `ADO_PROJECT`, and PAT scopes. The PAT needs **Code: Read & Write** permissions.

**No inline comments appear on the PR**
Azure DevOps threads require right-side line ranges. Ensure `startLine`/`endLine` map to the PR source (after) file. Check the audit trail in `.data/audit.jsonl` to see if findings were posted, filtered, or skipped.

**Provider config errors at startup**
The service validates provider-specific env vars at boot. Start with `LLM1_PROVIDER=mock` and `LLM2_PROVIDER=mock` to verify the wiring works, then switch to real providers.

**LLM4 visual checks not running**
- Verify `LLM4_ENABLED=true` and `LLM4_PROVIDER` is set to `openai` or `anthropic` (not `azure_openai`)
- The webhook payload must include a `previewUrl` field
- Playwright must be installed: `npm install playwright` then `npx playwright install chromium`
- Check logs for "Playwright not installed" or "provider does not support vision" warnings

**Large PR timeouts**
In synchronous mode (no Redis), reviews have a 2-minute timeout. For large PRs:
- Reduce `MAX_FILES`, `MAX_HUNKS`, or `MAX_TOTAL_DIFF_LINES`
- Enable queue mode with `REDIS_URL` (no timeout on the webhook, retries on failure)

**Duplicate comments on PRs**
The idempotency store (`.data/idempotency.json`) may be inaccessible. Check write permissions on the `.data/` directory. In Docker, ensure the directory is writable by the `appuser` (UID 1001).

**Review too noisy / too quiet**
- Increase `REVIEW_MIN_SEVERITY` to `medium` or `high` to reduce noise
- Set `REVIEW_STRICTNESS=relaxed` to focus only on critical issues
- Set `REVIEW_STRICTNESS=strict` for thorough reviews
