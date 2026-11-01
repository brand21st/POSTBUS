#!/usr/bin/env bash
# Host-side isolated Event Download smoke. Run on the Coolify VPS as root.
# Does not modify the production application container or its files.
# Does not call CEPT unless INDIA_POST_SMOKE=1 and INDIA_POST_SMOKE_APPROVED=1.
set -euo pipefail

ORG_ID="${INDIA_POST_SMOKE_ORG_ID:-c40cb948-5778-421a-a831-1989adcbcb0f}"
KNOWN_AWB="${INDIA_POST_SMOKE_KNOWN_AWB:-EY592889005IN}"
EVENT_DATE="${INDIA_POST_SMOKE_EVENT_DATE:-21102026}"
SRC_DIR="${POSTBUS_SMOKE_SRC:-/tmp/postbus-ed-smoke}"
APP_UUID="${COOLIFY_APPLICATION_UUID:-mw9larpomkyonxzy1rk3h6jm}"

if [[ "${INDIA_POST_SMOKE:-}" != "1" || "${INDIA_POST_SMOKE_APPROVED:-}" != "1" ]]; then
  echo '{"status":"NOT_RUN","reason":"Set INDIA_POST_SMOKE=1 and INDIA_POST_SMOKE_APPROVED=1 on the VPS host, then re-run."}'
  exit 0
fi

if [[ ! -f "$SRC_DIR/scripts/india-post-event-download-smoke.mts" || ! -f "$SRC_DIR/package-lock.json" ]]; then
  echo "{\"status\":\"FAIL\",\"reason\":\"V2 smoke tree missing at $SRC_DIR (need scripts/india-post-event-download-smoke.mts and package-lock.json).\"}"
  exit 2
fi

PROD="$(docker ps --format '{{.Names}}' | grep -E "^${APP_UUID}-" | head -n 1 || true)"
if [[ -z "$PROD" ]]; then
  PROD="$(docker ps --format '{{.Names}}\t{{.Image}}' | awk '/postbus|mw9lar/ {print $1; exit}')"
fi
if [[ -z "$PROD" ]]; then
  echo '{"status":"FAIL","reason":"Production PostBus container not found. Run docker ps and set PROD_CONTAINER."}'
  exit 2
fi

EGRESS="$(docker exec "$PROD" sh -c 'wget -qO- https://api.ipify.org 2>/dev/null || curl -fsS https://api.ipify.org')"
echo "{\"status\":\"PRECHECK\",\"productionContainer\":\"$PROD\",\"egressIpv4\":\"$EGRESS\"}"
if [[ "$EGRESS" != "89.116.34.166" ]]; then
  echo '{"status":"FAIL","reason":"Container egress IPv4 is not 89.116.34.166. Stop."}'
  exit 2
fi

ENVFILE="$(mktemp)"
chmod 600 "$ENVFILE"
cleanup() {
  rm -f "$ENVFILE"
}
trap cleanup EXIT

docker exec "$PROD" sh -c 'printf "NEXT_PUBLIC_SUPABASE_URL=%s\nSUPABASE_SERVICE_ROLE_KEY=%s\nINTEGRATION_ENCRYPTION_KEY=%s\nINDIA_POST_PROD_BASE_URL=%s\n" \
  "$NEXT_PUBLIC_SUPABASE_URL" "$SUPABASE_SERVICE_ROLE_KEY" "$INTEGRATION_ENCRYPTION_KEY" "$INDIA_POST_PROD_BASE_URL"' >"$ENVFILE"

docker run --rm \
  --network "container:${PROD}" \
  --read-only \
  --tmpfs /work:rw,exec,mode=1777 \
  --tmpfs /tmp:rw,mode=1777 \
  -v "${SRC_DIR}:/src:ro" \
  --env-file "$ENVFILE" \
  -e INDIA_POST_SMOKE=1 \
  -e INDIA_POST_SMOKE_APPROVED=1 \
  -e INDIA_POST_SMOKE_ORG_ID="$ORG_ID" \
  -e INDIA_POST_SMOKE_KNOWN_AWB="$KNOWN_AWB" \
  -e INDIA_POST_SMOKE_EVENT_DATE="$EVENT_DATE" \
  -e HOME=/work \
  -e npm_config_update_notifier=false \
  node:22-bookworm \
  bash -lc 'set -euo pipefail
cp -a /src/. /work/
cd /work
npm ci --ignore-scripts
npx --no-install tsx scripts/india-post-event-download-smoke.mts'
