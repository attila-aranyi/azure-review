#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────
# AI Code Review — Azure Demo Deployment
# Provisions all Azure resources, builds/pushes the Docker
# image, deploys the service, and configures the ADO webhook.
# ──────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ── Resource naming ──────────────────────────────────────
LOCATION="westeurope"
PSQL_LOCATION="northeurope"  # Postgres may be restricted in some regions
RESOURCE_GROUP="rg-code-review-demo"
ACR_NAME="acrcodereviewdemo"
CAE_NAME="cae-code-review"
CAE_RESOURCE_GROUP="rg-code-review"  # Existing environment in a different RG
CA_NAME="ca-llm-review-demo"
CA_REDIS_NAME="ca-redis-demo"
PSQL_SERVER="psql-code-review-demo"
PSQL_DB="llmreview"
PSQL_ADMIN_USER="llmreviewadmin"
IMAGE_NAME="llm-review-service"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC}  $1"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $1"; exit 1; }
step()  { echo -e "\n${BLUE}═══ $1 ═══${NC}"; }

# ── Pre-flight checks ───────────────────────────────────
step "Pre-flight checks"

command -v az &>/dev/null || fail "Azure CLI not found. Install: https://aka.ms/install-azure-cli"
command -v docker &>/dev/null || fail "Docker not found."

az account show &>/dev/null || fail "Not logged in to Azure. Run: az login"
SUBSCRIPTION=$(az account show --query name -o tsv)
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
ok "Azure subscription: $SUBSCRIPTION ($SUBSCRIPTION_ID)"
ok "Target region: $LOCATION"

# ── Interactive prompts ──────────────────────────────────
step "Configuration"

read -rp "  Azure DevOps organization name (e.g., myorg): " ADO_ORG
[ -z "$ADO_ORG" ] && fail "ADO organization name is required"

read -rp "  Azure DevOps project name: " ADO_PROJECT
[ -z "$ADO_PROJECT" ] && fail "ADO project name is required"

read -rp "  Azure DevOps PAT (Code R/W + Service Hooks R/W): " ADO_PAT
[ -z "$ADO_PAT" ] && fail "ADO PAT is required"

read -rp "  Anthropic API key: " ANTHROPIC_API_KEY
[ -z "$ANTHROPIC_API_KEY" ] && fail "Anthropic API key is required"

# Generate secrets
WEBHOOK_SECRET=$(openssl rand -hex 32)
PSQL_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')
TOKEN_ENCRYPTION_KEY=$(openssl rand -hex 32)

ok "Configuration collected"

# ── 1. Resource Group ────────────────────────────────────
step "1/8 — Resource Group"

if az group show --name "$RESOURCE_GROUP" &>/dev/null; then
  ok "Resource group '$RESOURCE_GROUP' already exists"
else
  az group create --name "$RESOURCE_GROUP" --location "$LOCATION" -o none
  ok "Created resource group '$RESOURCE_GROUP'"
fi

# ── 2. Container Registry ───────────────────────────────
step "2/8 — Container Registry"

if az acr show --name "$ACR_NAME" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
  ok "ACR '$ACR_NAME' already exists"
else
  az acr create \
    --name "$ACR_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --sku Basic \
    --admin-enabled true \
    -o none
  ok "Created ACR '$ACR_NAME'"
fi

ACR_SERVER=$(az acr show --name "$ACR_NAME" --query loginServer -o tsv)

# ── 3. PostgreSQL Flexible Server ────────────────────────
step "3/8 — PostgreSQL"

if az postgres flexible-server show --name "$PSQL_SERVER" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
  ok "PostgreSQL '$PSQL_SERVER' already exists"
else
  az postgres flexible-server create \
    --name "$PSQL_SERVER" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$PSQL_LOCATION" \
    --admin-user "$PSQL_ADMIN_USER" \
    --admin-password "$PSQL_PASSWORD" \
    --sku-name Standard_B1ms \
    --tier Burstable \
    --storage-size 32 \
    --version 16 \
    --public-access 0.0.0.0 \
    --yes \
    -o none
  ok "Created PostgreSQL '$PSQL_SERVER'"
fi

# Create database
az postgres flexible-server db create \
  --server-name "$PSQL_SERVER" \
  --resource-group "$RESOURCE_GROUP" \
  --database-name "$PSQL_DB" \
  -o none 2>/dev/null || true

PSQL_HOST=$(az postgres flexible-server show --name "$PSQL_SERVER" --resource-group "$RESOURCE_GROUP" --query fullyQualifiedDomainName -o tsv)
DATABASE_URL="postgresql://${PSQL_ADMIN_USER}:${PSQL_PASSWORD}@${PSQL_HOST}:5432/${PSQL_DB}?sslmode=require"
ok "Database URL configured"

# ── 4. Container Apps Environment ────────────────────────
step "4/8 — Container Apps Environment"

if az containerapp env show --name "$CAE_NAME" --resource-group "$CAE_RESOURCE_GROUP" &>/dev/null; then
  ok "Reusing existing Container Apps environment '$CAE_NAME' in '$CAE_RESOURCE_GROUP'"
else
  fail "Container Apps environment '$CAE_NAME' not found in '$CAE_RESOURCE_GROUP'. Create it manually or update CAE_NAME/CAE_RESOURCE_GROUP."
fi

CAE_ID=$(az containerapp env show --name "$CAE_NAME" --resource-group "$CAE_RESOURCE_GROUP" --query id -o tsv)

# ── 5. Redis Container ──────────────────────────────────
step "5/8 — Redis Container"

if az containerapp show --name "$CA_REDIS_NAME" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
  ok "Redis container '$CA_REDIS_NAME' already exists"
else
  az containerapp create \
    --name "$CA_REDIS_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --environment "$CAE_ID" \
    --image redis:7-alpine \
    --cpu 0.25 \
    --memory 0.5Gi \
    --min-replicas 1 \
    --max-replicas 1 \
    --ingress internal \
    --target-port 6379 \
    --transport tcp \
    -o none
  ok "Created Redis container '$CA_REDIS_NAME'"
fi

REDIS_FQDN=$(az containerapp show --name "$CA_REDIS_NAME" --resource-group "$RESOURCE_GROUP" --query "properties.configuration.ingress.fqdn" -o tsv)
REDIS_URL="redis://${REDIS_FQDN}:6379"
ok "Redis URL: $REDIS_URL"

# ── 6. Build & Push Docker Image ────────────────────────
step "6/8 — Build & Push Docker Image"

info "Logging in to ACR..."
az acr login --name "$ACR_NAME" -o none

info "Building image locally..."
docker build -t "${ACR_SERVER}/${IMAGE_NAME}:latest" -f "$SERVICE_DIR/Dockerfile" "$SERVICE_DIR"

info "Pushing image..."
docker push "${ACR_SERVER}/${IMAGE_NAME}:latest"

ok "Image pushed to ${ACR_SERVER}/${IMAGE_NAME}:latest"

# ── 7. Deploy Container App ─────────────────────────────
step "7/8 — Deploy Service"

ACR_USERNAME=$(az acr credential show --name "$ACR_NAME" --query username -o tsv)
ACR_PASSWORD=$(az acr credential show --name "$ACR_NAME" --query "passwords[0].value" -o tsv)

if az containerapp show --name "$CA_NAME" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
  info "Updating existing Container App..."
  az containerapp update \
    --name "$CA_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --image "${ACR_SERVER}/${IMAGE_NAME}:latest" \
    --set-env-vars \
      "DEPLOYMENT_MODE=self-hosted" \
      "DATABASE_URL=${DATABASE_URL}" \
      "REDIS_URL=${REDIS_URL}" \
      "ADO_ORG=${ADO_ORG}" \
      "ADO_PROJECT=${ADO_PROJECT}" \
      "ADO_PAT=${ADO_PAT}" \
      "WEBHOOK_SECRET=${WEBHOOK_SECRET}" \
      "TOKEN_ENCRYPTION_KEY=${TOKEN_ENCRYPTION_KEY}" \
      "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}" \
      "LLM1_PROVIDER=anthropic" \
      "LLM2_PROVIDER=anthropic" \
      "ANTHROPIC_MODEL_LLM1=claude-sonnet-4-20250514" \
      "ANTHROPIC_MODEL_LLM2=claude-sonnet-4-20250514" \
      "PORT=3000" \
      "LOG_LEVEL=info" \
    -o none
else
  az containerapp create \
    --name "$CA_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --environment "$CAE_ID" \
    --image "${ACR_SERVER}/${IMAGE_NAME}:latest" \
    --registry-server "$ACR_SERVER" \
    --registry-username "$ACR_USERNAME" \
    --registry-password "$ACR_PASSWORD" \
    --cpu 0.5 \
    --memory 1Gi \
    --min-replicas 1 \
    --max-replicas 3 \
    --ingress external \
    --target-port 3000 \
    --env-vars \
      "DEPLOYMENT_MODE=self-hosted" \
      "DATABASE_URL=${DATABASE_URL}" \
      "REDIS_URL=${REDIS_URL}" \
      "ADO_ORG=${ADO_ORG}" \
      "ADO_PROJECT=${ADO_PROJECT}" \
      "ADO_PAT=${ADO_PAT}" \
      "WEBHOOK_SECRET=${WEBHOOK_SECRET}" \
      "TOKEN_ENCRYPTION_KEY=${TOKEN_ENCRYPTION_KEY}" \
      "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}" \
      "LLM1_PROVIDER=anthropic" \
      "LLM2_PROVIDER=anthropic" \
      "ANTHROPIC_MODEL_LLM1=claude-sonnet-4-20250514" \
      "ANTHROPIC_MODEL_LLM2=claude-sonnet-4-20250514" \
      "PORT=3000" \
      "LOG_LEVEL=info" \
    -o none
fi

SERVICE_URL=$(az containerapp show --name "$CA_NAME" --resource-group "$RESOURCE_GROUP" --query "properties.configuration.ingress.fqdn" -o tsv)
SERVICE_URL="https://${SERVICE_URL}"
ok "Service deployed: $SERVICE_URL"

# Wait for health check
info "Waiting for service to start..."
for i in {1..30}; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "${SERVICE_URL}/health" 2>/dev/null) || true
  if [ "$HTTP_CODE" = "200" ]; then
    ok "Service is healthy"
    break
  fi
  if [ "$i" = "30" ]; then
    warn "Service not yet healthy after 60s. Check logs: az containerapp logs show --name $CA_NAME --resource-group $RESOURCE_GROUP"
  fi
  sleep 2
done

# ── 8. Configure ADO Webhook ────────────────────────────
step "8/8 — Azure DevOps Webhook"

# Get tenant ID from the service
TENANT_RESPONSE=$(curl -s -H "Authorization: Bearer ${ADO_PAT}" "${SERVICE_URL}/api/tenants" 2>/dev/null) || true
TENANT_ID=$(echo "$TENANT_RESPONSE" | python3 -c "import sys,json; data=json.load(sys.stdin); print(data[0]['id'] if isinstance(data, list) and len(data)>0 else '')" 2>/dev/null) || true

if [ -z "$TENANT_ID" ]; then
  # Service auto-creates tenant on startup in self-hosted mode; try health endpoint first
  sleep 3
  TENANT_RESPONSE=$(curl -s -H "Authorization: Bearer ${ADO_PAT}" "${SERVICE_URL}/api/tenants" 2>/dev/null) || true
  TENANT_ID=$(echo "$TENANT_RESPONSE" | python3 -c "import sys,json; data=json.load(sys.stdin); print(data[0]['id'] if isinstance(data, list) and len(data)>0 else '')" 2>/dev/null) || true
fi

WEBHOOK_URL="${SERVICE_URL}/webhooks/ado/${TENANT_ID}"

if [ -n "$TENANT_ID" ]; then
  info "Webhook URL: $WEBHOOK_URL"

  # Create service hook subscription via ADO REST API
  ADO_BASE_URL="https://dev.azure.com/${ADO_ORG}"
  B64_PAT=$(echo -n ":${ADO_PAT}" | base64)

  # Get project ID
  PROJECT_ID=$(curl -s \
    -H "Authorization: Basic ${B64_PAT}" \
    "${ADO_BASE_URL}/_apis/projects/${ADO_PROJECT}?api-version=7.1" \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null) || true

  if [ -n "$PROJECT_ID" ]; then
    # Create service hook for PR created events
    HOOK_PAYLOAD=$(cat <<HOOKEOF
{
  "publisherId": "tfs",
  "eventType": "git.pullrequest.created",
  "consumerId": "webHooks",
  "consumerActionId": "httpRequest",
  "publisherInputs": {
    "projectId": "${PROJECT_ID}"
  },
  "consumerInputs": {
    "url": "${WEBHOOK_URL}",
    "basicAuthUsername": "ado",
    "basicAuthPassword": "${WEBHOOK_SECRET}",
    "resourceDetailsToSend": "all",
    "messagesToSend": "all"
  }
}
HOOKEOF
)

    HOOK_RESULT=$(curl -s -o /dev/null -w "%{http_code}" \
      -X POST \
      -H "Authorization: Basic ${B64_PAT}" \
      -H "Content-Type: application/json" \
      -d "$HOOK_PAYLOAD" \
      "${ADO_BASE_URL}/_apis/hooks/subscriptions?api-version=7.1") || true

    if [ "$HOOK_RESULT" = "200" ] || [ "$HOOK_RESULT" = "201" ]; then
      ok "Created ADO webhook for PR created events"
    else
      warn "Failed to create ADO webhook (HTTP $HOOK_RESULT). Create manually in ADO Project Settings > Service Hooks."
    fi

    # Create service hook for PR updated events
    HOOK_PAYLOAD_UPDATED=$(cat <<HOOKEOF2
{
  "publisherId": "tfs",
  "eventType": "git.pullrequest.updated",
  "consumerId": "webHooks",
  "consumerActionId": "httpRequest",
  "publisherInputs": {
    "projectId": "${PROJECT_ID}"
  },
  "consumerInputs": {
    "url": "${WEBHOOK_URL}",
    "basicAuthUsername": "ado",
    "basicAuthPassword": "${WEBHOOK_SECRET}",
    "resourceDetailsToSend": "all",
    "messagesToSend": "all"
  }
}
HOOKEOF2
)

    HOOK_RESULT_UPDATED=$(curl -s -o /dev/null -w "%{http_code}" \
      -X POST \
      -H "Authorization: Basic ${B64_PAT}" \
      -H "Content-Type: application/json" \
      -d "$HOOK_PAYLOAD_UPDATED" \
      "${ADO_BASE_URL}/_apis/hooks/subscriptions?api-version=7.1") || true

    if [ "$HOOK_RESULT_UPDATED" = "200" ] || [ "$HOOK_RESULT_UPDATED" = "201" ]; then
      ok "Created ADO webhook for PR updated events"
    else
      warn "Failed to create ADO webhook for PR updated (HTTP $HOOK_RESULT_UPDATED)"
    fi
  else
    warn "Could not resolve ADO project ID. Create webhook manually."
  fi
else
  warn "Could not retrieve tenant ID. Webhook URL will be: ${SERVICE_URL}/webhooks/ado/<tenantId>"
  warn "Check service logs and create webhook manually."
fi

# ── Summary ──────────────────────────────────────────────
echo
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}   Deployment Complete                             ${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo
echo "  Service URL:  $SERVICE_URL"
echo "  Health check: ${SERVICE_URL}/health"
[ -n "$TENANT_ID" ] && echo "  Webhook URL:  $WEBHOOK_URL"
echo
echo "  Resource Group: $RESOURCE_GROUP"
echo "  PostgreSQL:     $PSQL_HOST"
echo "  ACR:            $ACR_SERVER"
echo
echo "  Useful commands:"
echo "    Logs:     az containerapp logs show --name $CA_NAME --resource-group $RESOURCE_GROUP --follow"
echo "    Restart:  az containerapp revision restart --name $CA_NAME --resource-group $RESOURCE_GROUP"
echo "    Teardown: az group delete --name $RESOURCE_GROUP --yes --no-wait"
echo
