#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# test-call.sh – Trigger a test Vapi call via API
# Usage: ./scripts/test-call.sh [phone_number]
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# Load env safely
if [ ! -f .env ]; then
  echo "FEHLER: .env Datei nicht gefunden"
  exit 1
fi
set -a
source .env
set +a

PHONE="${1:-+491234567890}"

# Validate required variables
if [ -z "${VAPI_API_KEY:-}" ]; then
  echo "FEHLER: VAPI_API_KEY nicht gesetzt"
  exit 1
fi
if [ -z "${VAPI_ASSISTANT_ID:-}" ]; then
  echo "FEHLER: VAPI_ASSISTANT_ID nicht gesetzt"
  exit 1
fi
if [ -z "${VAPI_PHONE_NUMBER_ID:-}" ]; then
  echo "FEHLER: VAPI_PHONE_NUMBER_ID nicht gesetzt"
  exit 1
fi

echo "Triggering test call to: $PHONE"
echo "    Assistant: $VAPI_ASSISTANT_ID"
echo ""

# Use jq for safe JSON construction to prevent injection
PAYLOAD=$(python3 -c "
import json, sys
print(json.dumps({
    'phoneNumberId': sys.argv[1],
    'assistantId': sys.argv[2],
    'customer': {'number': sys.argv[3]}
}))
" "$VAPI_PHONE_NUMBER_ID" "$VAPI_ASSISTANT_ID" "$PHONE")

curl -s -X POST "https://api.vapi.ai/call" \
  -H "Authorization: Bearer $VAPI_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" | python3 -m json.tool

echo ""
echo "Call initiated. Check Vapi Dashboard for recording."
