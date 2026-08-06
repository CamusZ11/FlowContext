#!/bin/sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$root_dir"
. "$root_dir/env.sh"

fail() {
  printf '%s\n' "deployment failed: $1" >&2
  exit 1
}

[ -f "$root_dir/.env" ] || fail "create deploy/flowcontext/.env from .env.example first"
env_mode=$(stat -c '%a' "$root_dir/.env" 2>/dev/null || stat -f '%Lp' "$root_dir/.env")
[ "$env_mode" = "600" ] || fail ".env permissions must be 0600"
load_flowcontext_env "$root_dir/.env" || fail ".env must contain each expected literal key exactly once"
[ -n "${FLOWCONTEXT_PUBLIC_URL:-}" ] || fail "FLOWCONTEXT_PUBLIC_URL is required"

./preflight.sh
docker compose --env-file .env config >/dev/null
docker compose --env-file .env up -d --build --wait --wait-timeout 120
curl --fail --silent --show-error --retry 12 --retry-delay 5 --retry-connrefused "http://127.0.0.1:18080/healthz" >/dev/null
curl --fail --silent --show-error --retry 12 --retry-delay 5 --retry-connrefused "https://$FLOWCONTEXT_PUBLIC_URL/healthz" >/dev/null
docker compose ps
printf 'deployed: https://%s\n' "$FLOWCONTEXT_PUBLIC_URL"
