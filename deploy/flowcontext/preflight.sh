#!/bin/sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
data_dir=${FLOWCONTEXT_DATA_DIR:-/srv/flowcontext/data}

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

set -a
. "$root_dir/.env"
set +a
for key in POSTGRES_PASSWORD FLOWCONTEXT_OWNER_ID FLOWCONTEXT_PUBLIC_URL ACME_EMAIL; do
  eval "value=\${$key:-}"
  [ -n "$value" ] || fail "$key is required"
done

case "$FLOWCONTEXT_PUBLIC_URL" in
  *://*|*/*|*:*|*' '*) fail "FLOWCONTEXT_PUBLIC_URL must be a DNS hostname without a scheme or path" ;;
esac
printf '%s' "$FLOWCONTEXT_PUBLIC_URL" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$' \
  || fail "FLOWCONTEXT_PUBLIC_URL must be a public DNS hostname"
getent hosts "$FLOWCONTEXT_PUBLIC_URL" >/dev/null 2>&1 || fail "DNS must resolve before Caddy can obtain HTTPS certificates"

mkdir -p "$data_dir/caddy-data" "$data_dir/caddy-config" || fail "data path is not writable"
[ -w "$data_dir/caddy-data" ] && [ -w "$data_dir/caddy-config" ] || fail "data path is not writable"

printf '%s\n' "preflight passed"
