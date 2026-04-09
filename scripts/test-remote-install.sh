#!/usr/bin/env bash
set -euo pipefail

STATIC_HOST="${STATIC_HOST:-203.0.113.10}"
STATIC_USER="${STATIC_USER:-root}"
DNS_HOST="${DNS_HOST:-203.0.113.10}"
DNS_USER="${DNS_USER:-root}"
ADAPTER_BASE_URL="${ADAPTER_BASE_URL:-https://box.example.com}"
ADAPTER_SECRET="${ADAPTER_SECRET:?set ADAPTER_SECRET}"
SSH_OPTS=${SSH_OPTS:-"-o BatchMode=yes -o StrictHostKeyChecking=accept-new"}
ZONE="${ZONE:-example.com}"
A_RECORD="${A_RECORD:-203.0.113.10}"

ssh $SSH_OPTS "${STATIC_USER}@${STATIC_HOST}" 'systemctl is-active clawfirm-boxd && systemctl is-enabled clawfirm-boxd'
ssh $SSH_OPTS "${DNS_USER}@${DNS_HOST}" "/usr/local/bin/clawfirm-dns-read <<< '{\"zone\":\"${ZONE}\"}'" || true

curl -fsS "${ADAPTER_BASE_URL}/health"

curl -fsS -X POST "${ADAPTER_BASE_URL}/dns/ensure-zone" \
  -H "Authorization: Bearer ${ADAPTER_SECRET}" \
  -H 'Content-Type: application/json' \
  -d "{\"zone\":\"${ZONE}\",\"requestedBy\":\"deploy-test\",\"reason\":\"bootstrap box zone\"}"

curl -fsS -X POST "${ADAPTER_BASE_URL}/dns/apply-records" \
  -H "Authorization: Bearer ${ADAPTER_SECRET}" \
  -H 'Content-Type: application/json' \
  -d "{\"zone\":\"${ZONE}\",\"requestedBy\":\"deploy-test\",\"reason\":\"point apex at box\",\"records\":[{\"type\":\"A\",\"name\":\"@\",\"value\":\"${A_RECORD}\",\"ttl\":300}]}"

curl -fsS -X POST "${ADAPTER_BASE_URL}/dns/get-zone" \
  -H "Authorization: Bearer ${ADAPTER_SECRET}" \
  -H 'Content-Type: application/json' \
  -d "{\"zone\":\"${ZONE}\"}"
