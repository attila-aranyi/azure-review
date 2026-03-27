# AI Code Review for Azure DevOps

An AI-powered code review service that integrates with Azure DevOps pull requests. It uses a multi-stage LLM pipeline to analyze code diffs and post actionable findings as inline PR comments.

## How It Works

```
Azure DevOps PR (webhook)
        |
   Fastify Server
        |
   Review Pipeline:
   1. LLM1: Context Preprocessor
   2. LLM2: Code Reviewer (+ custom rules)
   3. LLM3: Accessibility Checker (optional)
   4. LLM4: Visual Accessibility (optional)
        |
   Post findings as PR comments
```

The service supports both **SaaS** (multi-tenant, OAuth) and **self-hosted** (single-tenant, PAT auth) deployment modes.

## Features

### Core
- Multi-stage LLM pipeline with support for Anthropic, OpenAI, and Azure OpenAI
- Inline PR comments with severity levels (critical, high, medium, low)
- Idempotent findings (no duplicate comments on re-review)
- Configurable review strictness (relaxed, balanced, strict)
- File filtering via include/exclude globs

### Multi-Tenant (SaaS)
- OAuth 2.0 authorization with Azure DevOps
- Per-tenant encrypted token storage (AES-256-GCM)
- Per-tenant rate limiting
- BYOK (Bring Your Own Key) LLM support
- Usage tracking with plan enforcement (free, pro, enterprise)

### Custom Review Rules
- Structured rules with category, severity, file glob, and examples
- Tenant-level and repo-level rule scopes (25 rules per scope)
- Prompt injection protection via keyword blocklist and XML sandboxing
- API: `GET/POST /api/rules`, `PUT/DELETE /api/rules/:id`
- Repo-scoped: `GET/POST /api/repos/:repoId/rules`, `GET /api/repos/:repoId/rules/effective`

### Audit Log Export
- `GET /api/export/audit?from=YYYY-MM-DD&to=YYYY-MM-DD&format=json|csv`
- Reviews + findings data, 90-day date range cap
- JSON (nested) or CSV (flattened, one row per finding)

### Code Intelligence (Optional)
- Axon sidecar for impact analysis, dead code detection, and call graphs
- Enriches LLM context with structural code information
- Graph proxy API for dashboard visualization
- Graceful degradation when unavailable

### Dashboard
- Standalone web dashboard (Next.js + Tailwind + Tremor)
- PAT-based authentication
- **Dashboard Home** — KPI cards, findings trend chart, issue type breakdown, recent reviews
- **Review Log** — paginated review list, drill-down to findings with severity badges, feedback (thumbs up/down)
- **Code Graph** — interactive Cytoscape.js visualization of Axon symbol graph, impact analysis, dead code highlighting
- **Rules Editor** — CRUD for custom review rules with inline validation
- **Settings** — tenant config, review strictness, LLM provider status, project enrollment
- **Usage & Audit** — daily/monthly usage charts, plan limits, audit log export (JSON/CSV download)

## Quick Start (Self-Hosted)

### Prerequisites
- Docker and Docker Compose
- An Azure DevOps PAT with **Code (Read & Write)** scope
- An LLM API key (Anthropic, OpenAI, or Azure OpenAI)

### Setup

```bash
cd deploy/self-hosted
./setup.sh        # Interactive first-time setup
docker compose up -d
```

The setup wizard will:
1. Prompt for ADO connection details, LLM provider, and database config
2. Generate a `.env` file with a secure webhook secret
3. Validate connectivity (ADO API, LLM key, PostgreSQL)

On subsequent runs, `./setup.sh` validates the existing `.env` without prompting.

### Manual Setup

```bash
cd deploy/self-hosted
cp .env.example .env
# Edit .env with your values
docker compose up -d
```

### Optional Services

```bash
# Enable Redis for async processing
docker compose --profile redis up -d

# Enable Axon code intelligence
docker compose --profile axon up -d
```

### Upgrades

Pull new images and restart. Database migrations run automatically on startup.

```bash
docker compose pull
docker compose up -d
```

### Azure Demo Deployment

A one-command deploy script provisions all Azure resources:

```bash
cd deploy/azure-demo
./deploy.sh        # Provisions ACR, Postgres, Container Apps, configures webhooks
./teardown.sh      # Deletes all resources
```

## Dashboard

The dashboard is a standalone Next.js web app in the `dashboard/` directory.

### Running Locally

```bash
cd dashboard
npm install
npm run dev        # http://localhost:3000
```

Connect by entering your service URL and PAT in the login form.

### Deploying

The dashboard exports as static files (`output: "export"` in next.config.ts) suitable for Azure Static Web Apps, Vercel, or any static hosting.

```bash
cd dashboard
npm run build      # Generates static export in out/
```

## Development

### Prerequisites
- Node.js 20+
- PostgreSQL 16 (for integration tests)
- Python 3.13 (for axon-sidecar tests)

### Setup

```bash
cd llm-review-service
npm install
cp .env.example .env
# Edit .env with your values
```

### Commands

```bash
npm run dev          # Start with hot reload
npm run build        # Compile TypeScript
npm run typecheck    # Type check without emitting
npm run lint         # Run ESLint
npm run test         # Run tests
npm run test:coverage # Run tests with coverage report
```

### Running with Database

```bash
# Start PostgreSQL (via Docker)
docker compose up postgres -d

# Set DATABASE_URL
export DATABASE_URL=postgresql://llmreview:yourpassword@localhost:5432/llmreview

# Run with auto-migration
npm run dev
```

### Project Structure

```
llm-review-service/
  src/
    app.ts                  # Fastify app builder
    server.ts               # Entry point, graceful shutdown
    config/                 # App config (env vars) + config resolver
    auth/                   # Encryption, OAuth token management
    middleware/             # JWT/API key auth, rate limiting
    db/                     # Drizzle ORM schema, repos, migrations
    llm/                    # LLM clients, prompts, providers
    review/                 # Review pipeline, rules, severity, audit
    routes/                 # Webhook, auth, and API routes
    axon/                   # Axon client, context enricher
    axon-sidecar/           # Python FastAPI sidecar (code intelligence)
    selfHosted/             # Self-hosted bootstrap logic
  deploy/
    self-hosted/            # Docker Compose, .env.example, setup.sh
    azure-demo/             # Azure deployment script + teardown
  test/                     # Vitest tests (560 tests)
dashboard/
  src/app/                  # Next.js pages (home, reviews, graph, rules, settings, usage)
  src/components/           # Layout, sidebar, login form
  src/lib/                  # API client, auth context
```

## Architecture

### Deployment Modes

| | SaaS | Self-Hosted |
|---|---|---|
| Multi-tenancy | Yes (per ADO org) | No (single tenant, auto-created) |
| Auth | OAuth 2.0 | PAT |
| LLM keys | Managed or BYOK | BYOK mandatory |
| Billing | Plan enforcement | Disabled |
| Database | External Postgres | Bundled or external |
| CORS | Configured origins | All origins allowed |

### Configuration Layers

Config is resolved in order, with each layer overriding the previous:

1. **System defaults** - hardcoded safe values
2. **Tenant config** - org-wide overrides
3. **Repo config** - per-repository overrides
4. **Plan caps** - limits based on subscription tier

### Tech Stack

- **Backend:** Node.js 20, TypeScript, Fastify, Drizzle ORM
- **Database:** PostgreSQL 16
- **Queue:** BullMQ + Redis (optional)
- **LLM Providers:** Anthropic, OpenAI, Azure OpenAI
- **Code Intelligence:** Python FastAPI sidecar (Axon)
- **Dashboard:** Next.js 16, Tailwind CSS, Tremor, Cytoscape.js
- **CI:** GitHub Actions (lint, typecheck, build, tests, Docker build)
- **Deployment:** Azure Container Apps, ACR, PostgreSQL Flexible Server

## API Reference

### Webhook
- `POST /webhooks/ado/:tenantId` - Receive PR events from Azure DevOps

### Auth
- `GET /auth/ado/authorize` - Start OAuth flow
- `GET /auth/ado/callback` - OAuth callback
- `DELETE /auth/ado/connection/:tenantId` - Revoke tokens

### Management API (JWT/PAT-protected)
- `GET /api/tenants/me` - Current tenant info
- `GET /api/tenants/me/status` - Tenant status with counts
- `GET/PUT /api/config` - Tenant-level review config
- `GET /api/projects` - List enrolled projects
- `GET /api/reviews` - List reviews (paginated)
- `GET /api/reviews/:id` - Review detail with findings
- `POST /api/reviews/:id/retrigger` - Re-run review
- `POST /api/reviews/:id/findings/:findingId/feedback` - Submit feedback
- `GET/POST /api/rules` - Tenant-level review rules
- `PUT/DELETE /api/rules/:ruleId` - Update/delete rule
- `GET/POST /api/repos/:repoId/rules` - Repo-level rules
- `GET /api/repos/:repoId/rules/effective` - Effective rules (tenant + repo)
- `GET/PUT/DELETE /api/repos/:repoId/config` - Repo config overrides
- `GET /api/repos/:repoId/config/effective` - Merged config
- `GET /api/usage` - Monthly usage summary
- `GET /api/usage/daily` - Daily usage breakdown
- `PUT/DELETE /api/config/llm-key` - BYOK LLM key management
- `GET /api/config/llm-status` - LLM config status
- `GET /api/export/audit` - Audit log export (JSON/CSV)
- `GET /api/repos/:repoId/graph` - Axon graph status
- `GET /api/repos/:repoId/graph/impact/:symbol` - Impact analysis
- `GET /api/repos/:repoId/graph/dead-code` - Dead code detection

## License

Private - All rights reserved.
