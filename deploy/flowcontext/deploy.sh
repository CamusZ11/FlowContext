#!/bin/sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$root_dir"

./preflight.sh
docker compose --env-file .env config >/dev/null
docker compose --env-file .env up -d --build --wait --wait-timeout 120
curl --fail --silent --show-error --retry 12 --retry-delay 5 --retry-connrefused "https://$FLOWCONTEXT_PUBLIC_URL/healthz" >/dev/null
docker compose ps
printf 'deployed: https://%s\n' "$FLOWCONTEXT_PUBLIC_URL"
