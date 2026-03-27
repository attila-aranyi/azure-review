#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────
# AI Code Review — Azure Demo Teardown
# Deletes all demo Azure resources.
# ──────────────────────────────────────────────────────────

RESOURCE_GROUP="rg-code-review-demo"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}This will delete the entire resource group '${RESOURCE_GROUP}' and all resources in it.${NC}"
echo
echo "Resources that will be destroyed:"
echo "  - Container App (ca-llm-review-demo)"
echo "  - Redis Container (ca-redis-demo)"
echo "  - Container Apps Environment (cae-code-review-demo)"
echo "  - PostgreSQL Flexible Server (psql-code-review-demo)"
echo "  - Container Registry (acrcodereviewdemo)"
echo

read -rp "Are you sure? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

echo
echo -e "Deleting resource group '${RESOURCE_GROUP}'..."
az group delete --name "$RESOURCE_GROUP" --yes --no-wait

echo -e "${GREEN}Teardown initiated. Resources will be deleted in the background.${NC}"
echo "Check status: az group show --name $RESOURCE_GROUP"
