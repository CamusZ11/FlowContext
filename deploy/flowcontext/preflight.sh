#!/bin/sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
data_dir=${FLOWCONTEXT_DATA_DIR:-/srv/flowcontext/data}
. "$root_dir/env.sh"

fail() {
  printf '%s\n' "preflight failed: $1" >&2
  exit 1
}

[ "$(id -u)" -ne 0 ] || fail "run as the non-root SSH deploy account"
[ -n "${SSH_CONNECTION:-}" ] || fail "run through the SSH deploy account"
[ -s "$HOME/.ssh/authorized_keys" ] || fail "an authorized SSH deploy key is required"
command -v docker >/dev/null 2>&1 || fail "docker is required"
docker compose version >/dev/null 2>&1 || fail "docker compose v2 is required"
[ -f "$root_dir/.env" ] || fail "create deploy/flowcontext/.env from .env.example first"
env_mode=$(stat -c '%a' "$root_dir/.env" 2>/dev/null || stat -f '%Lp' "$root_dir/.env")
[ "$env_mode" = "600" ] || fail ".env permissions must be 0600"

load_flowcontext_env "$root_dir/.env" || fail ".env must contain each expected literal key exactly once"
[ -n "$POSTGRES_PASSWORD" ] || fail "POSTGRES_PASSWORD is required"
[ -n "$FLOWCONTEXT_OWNER_ID" ] || fail "FLOWCONTEXT_OWNER_ID is required"
[ -n "$FLOWCONTEXT_PUBLIC_URL" ] || fail "FLOWCONTEXT_PUBLIC_URL is required"

[ "$FLOWCONTEXT_PUBLIC_URL" = "flowcontext.zkabi.cn" ] || fail "FLOWCONTEXT_PUBLIC_URL must be flowcontext.zkabi.cn"
getent hosts "$FLOWCONTEXT_PUBLIC_URL" >/dev/null 2>&1 || fail "DNS must resolve before Nginx TLS can be provisioned"
docker compose --env-file .env config >/dev/null || fail "docker compose configuration is invalid"

mkdir -p "$data_dir" || fail "data path is not writable"
[ -w "$data_dir" ] || fail "data path is not writable"

command -v nginx >/dev/null 2>&1 || fail "Nginx is required to own public TLS"
command -v ss >/dev/null 2>&1 || fail "ss is required to check the internal listener"
if ss -ltnH '( sport = :18080 )' | grep -q '.'; then
  fail "127.0.0.1:18080 is already in use"
fi
printf '%s\n' "Nginx owns public TLS; FlowContext will use 127.0.0.1:18080"
printf '%s\n' "preflight passed"
