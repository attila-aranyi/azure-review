# llm-review-service

Azure DevOps pull request review service (MVP): PR webhook → collect diffs → LLM1 context preprocessor → LLM2 reviewer → inline PR threads back to Azure DevOps.

## Prereqs

- Node.js 18+ (recommended LTS)
- An Azure DevOps PAT with repo read/write permissions

## Setup

```bash
cd llm-review-service
cp .env.example .env
```

Edit `.env`:

- `WEBHOOK_SECRET`: shared secret checked via `x-webhook-secret` header
- `ADO_ORG`, `ADO_PROJECT`, `ADO_PAT`
- `LLM1_PROVIDER`, `LLM2_PROVIDER` (`mock|openai|azure_openai|anthropic|custom`)
- Provider-specific keys/models/deployments (if not using `mock`)

## Run locally

```bash
npm install
npm run dev
```

The server listens on `http://localhost:$PORT`.

## Webhook endpoint

- `POST /webhooks/azure-devops/pr`
- Requires header: `x-webhook-secret: <WEBHOOK_SECRET>`

Minimal payload shape accepted (Azure DevOps Service Hooks include more fields):

```json
{
  "resource": {
    "pullRequestId": 123,
    "repository": { "id": "..." }
  }
}
```

Quick local smoke test:

```bash
curl -X POST "http://localhost:3000/webhooks/azure-devops/pr" \
  -H "content-type: application/json" \
  -H "x-webhook-secret: replace-me" \
  -d '{"resource":{"pullRequestId":123,"repository":{"id":"REPO_ID"}}}'
```

## Azure DevOps Service Hook checklist

1. Expose your local server with a tunnel:
   - ngrok: `ngrok http 3000`
   - cloudflared: `cloudflared tunnel --url http://localhost:3000`
2. Azure DevOps → Project Settings → Service hooks → Create subscription
3. Choose event type(s):
   - Pull request created
   - Pull request updated
4. Set the URL to: `https://<tunnel>/webhooks/azure-devops/pr`
5. Add request header `x-webhook-secret` with your `WEBHOOK_SECRET`
6. Test and save

## Providers

- `mock`: no external calls; returns a sample finding when the diff contains suspicious keywords (e.g. `TODO`, `eval(`, `any`)
- `openai`: uses OpenAI Responses API
- `azure_openai`: uses Azure OpenAI chat completions API
- `anthropic`: uses Anthropic Messages API (JSON-only response + validation)

## Optional queue mode (Redis)

If `REDIS_URL` is set, webhook requests enqueue a BullMQ job and a worker in the same process executes `runReview`.

Example local Redis:

```bash
docker run --rm -p 6379:6379 redis:7
```

Then set:

```bash
REDIS_URL=redis://localhost:6379
```

## Idempotency

Posted findings are deduped using a stable finding hash and stored in `./.data/idempotency.json` (ignored by git).

## Troubleshooting

- **401/403 from Azure DevOps**: verify `ADO_ORG`, `ADO_PROJECT`, and PAT scopes (Code: Read & Write).
- **No inline comments**: Azure threads require right-side line ranges; ensure `startLine/endLine` map to the PR source (after) file.
- **Provider config errors**: `src/config.ts` enforces provider-specific env vars; start with `LLM1_PROVIDER=mock` and `LLM2_PROVIDER=mock` to validate wiring.
