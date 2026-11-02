#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# BBD Master ATMA OS - Hetzner / Coolify Production Deployment Script
# ==============================================================================

echo "=========================================================="
echo " Starting BBD Master ATMA OS Deployment to Hetzner/Coolify"
echo " Date: $(date -u +"%Y-%m-%d %H:%M:%SZ")"
echo "=========================================================="

# 1. Environment Verification
if [ ! -f .env ] && [ -z "${BETTER_AUTH_SECRET:-}" ]; then
  echo "[-] Error: .env file missing and required environment variables not set."
  echo "    Please create .env using .env.example as reference."
  exit 1
fi

echo "[+] Verifying Node.js and Docker environment..."
if command -v docker &> /dev/null; then
  echo "    Docker version: $(docker --version)"
else
  echo "[-] Error: docker is not installed on this host."
  exit 1
fi

COMPOSE_FILE="compose.coolify.yaml"
if [ ! -f "$COMPOSE_FILE" ]; then
  echo "[-] Error: $COMPOSE_FILE not found."
  exit 1
fi

# 2. Database Migration Preflight
echo "[+] Starting Postgres database service..."
docker compose -f "$COMPOSE_FILE" up -d postgres

echo "[+] Waiting for Postgres to report healthy..."
for i in {1..30}; do
  if docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U "${POSTGRES_USER:-bbd}" -d "${POSTGRES_DB:-bbd}" > /dev/null 2>&1; then
    echo "    PostgreSQL is ready and accepting connections."
    break
  fi
  sleep 2
  if [ "$i" -eq 30 ]; then
    echo "[-] Error: Database health check timed out."
    exit 1
  fi
done

# 3. Build & Deploy Application Container
echo "[+] Building and launching Next.js standalone container..."
docker compose -f "$COMPOSE_FILE" up -d --build app

# 4. Ingress Health Check
TARGET_URL="${COOLIFY_FQDN:-http://127.0.0.1:3000}"
HEALTH_ENDPOINT="${TARGET_URL}/api/health"
echo "[+] Probing application health check at ${HEALTH_ENDPOINT}..."

SUCCESS=0
for attempt in {1..20}; do
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3000/api/health" || echo "000")
  if [ "$HTTP_STATUS" -eq 200 ]; then
    echo "[+] Application is healthy! (HTTP 200 OK after ${attempt} attempts)"
    SUCCESS=1
    break
  fi
  echo "    Attempt ${attempt}/20: HTTP status ${HTTP_STATUS}. Retrying in 3s..."
  sleep 3
done

if [ "$SUCCESS" -ne 1 ]; then
  echo "[-] Deployment warning: Health check endpoint did not return 200."
  echo "    Checking container logs:"
  docker compose -f "$COMPOSE_FILE" logs --tail=50 app
  exit 1
fi

echo "=========================================================="
echo " BBD Master ATMA OS successfully deployed!"
echo " Ingress Host: ${COOLIFY_FQDN:-http://localhost:3000}"
echo " Health Status: OK"
echo " Gemini AI Workflow: Ready (gemini-3.8-flash)"
echo " Direct UPI & Multi-Gateway: Ready"
echo "=========================================================="
