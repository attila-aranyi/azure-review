#!/usr/bin/env bash
#
# Provisions all Azure resources for the llm-review-service.
#
# Usage:
#   cp .env.azure.example .env.azure   # fill in secrets
#   bash infra/setup.sh
#
# Prerequisites:
#   - Azure CLI installed and logged in (az login)
#   - .env.azure file with all required variables populated
#
set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────
RESOURCE_GROUP="rg-code-review"
LOCATION="westeurope"
ACR_NAME="acrcodereview"           # must be globally unique, lowercase, alphanumeric
CAE_NAME="cae-code-review"         # Container Apps Environment
CA_NAME="ca-llm-review"            # Container App
TARGET_PORT=3000

# ── Load .env.azure ────────────────────────────────────────────────
ENV_FILE="${1:-.env.azure}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found. Copy .env.azure.example and fill in values."
  exit 1
fi

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

# ── Validate required variables ────────────────────────────────────
for var in WEBHOOK_SECRET ADO_ORG ADO_PROJECT ADO_PAT \
           ANTHROPIC_API_KEY LLM1_PROVIDER LLM2_PROVIDER; do
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: $var is not set in $ENV_FILE"
    exit 1
  fi
done

echo "==> Creating resource group: $RESOURCE_GROUP"
az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --output none

echo "==> Creating Azure Container Registry: $ACR_NAME"
az acr create \
  --name "$ACR_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --sku Basic \
  --admin-enabled true \
  --output none

echo "==> Retrieving ACR credentials"
ACR_LOGIN_SERVER=$(az acr show --name "$ACR_NAME" --query loginServer -o tsv)
ACR_USERNAME=$(az acr credential show --name "$ACR_NAME" --query username -o tsv)
ACR_PASSWORD=$(az acr credential show --name "$ACR_NAME" --query "passwords[0].value" -o tsv)

echo "==> Creating Container Apps Environment: $CAE_NAME"
az containerapp env create \
  --name "$CAE_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --output none

echo "==> Building and pushing Docker image to ACR"
az acr build \
  --registry "$ACR_NAME" \
  --image llm-review-service:initial \
  --file Dockerfile \
  . \
  --output none

echo "==> Creating Container App: $CA_NAME"
az containerapp create \
  --name "$CA_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --environment "$CAE_NAME" \
  --image "${ACR_LOGIN_SERVER}/llm-review-service:initial" \
  --registry-server "$ACR_LOGIN_SERVER" \
  --registry-username "$ACR_USERNAME" \
  --registry-password "$ACR_PASSWORD" \
  --target-port "$TARGET_PORT" \
  --ingress external \
  --min-replicas 0 \
  --max-replicas 1 \
  --env-vars \
    PORT="$TARGET_PORT" \
    NODE_ENV="production" \
    WEBHOOK_SECRET="$WEBHOOK_SECRET" \
    ADO_ORG="$ADO_ORG" \
    ADO_PROJECT="$ADO_PROJECT" \
    ADO_PAT="$ADO_PAT" \
    LLM1_PROVIDER="$LLM1_PROVIDER" \
    LLM2_PROVIDER="$LLM2_PROVIDER" \
    ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
    ANTHROPIC_MODEL_LLM1="${ANTHROPIC_MODEL_LLM1:-claude-sonnet-4-6}" \
    ANTHROPIC_MODEL_LLM2="${ANTHROPIC_MODEL_LLM2:-claude-sonnet-4-6}" \
    LLM3_ENABLED="${LLM3_ENABLED:-false}" \
    MAX_FILES="${MAX_FILES:-20}" \
    MAX_TOTAL_DIFF_LINES="${MAX_TOTAL_DIFF_LINES:-2000}" \
    MAX_HUNKS="${MAX_HUNKS:-80}" \
    HUNK_CONTEXT_LINES="${HUNK_CONTEXT_LINES:-20}" \
    TOKEN_BUDGET_LLM1="${TOKEN_BUDGET_LLM1:-3000}" \
    TOKEN_BUDGET_LLM2="${TOKEN_BUDGET_LLM2:-6000}" \
    RATE_LIMIT_MAX="${RATE_LIMIT_MAX:-30}" \
    RATE_LIMIT_WINDOW_MS="${RATE_LIMIT_WINDOW_MS:-60000}" \
  --output none

# ── Output ─────────────────────────────────────────────────────────
FQDN=$(az containerapp show \
  --name "$CA_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "properties.configuration.ingress.fqdn" -o tsv)

echo ""
echo "========================================================"
echo " Deployment complete!"
echo "========================================================"
echo ""
echo " Container App FQDN:  https://${FQDN}"
echo " Health check:        https://${FQDN}/health"
echo " Webhook URL:         https://${FQDN}/webhooks/azure-devops/pr"
echo ""
echo " ACR Login Server:    ${ACR_LOGIN_SERVER}"
echo ""
echo " Next steps:"
echo "   1. Verify health:  curl https://${FQDN}/health"
echo "   2. Configure Azure DevOps service hook:"
echo "      - Go to Project Settings > Service hooks > + > Web Hooks"
echo "      - Trigger: Pull request created / updated"
echo "      - URL: https://${FQDN}/webhooks/azure-devops/pr"
echo "      - HTTP header: x-webhook-secret: ${WEBHOOK_SECRET}"
echo "   3. Create a test PR to verify end-to-end"
echo "========================================================"
