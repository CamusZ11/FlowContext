#!/bin/sh
set -eu

UUID_PATTERN='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
device_id=${1:-}

if [ "$#" -ne 1 ] || ! printf '%s' "$device_id" | grep -Eq "$UUID_PATTERN"; then
  printf '%s\n' "usage: $0 <device-id UUID>" >&2
  exit 2
fi

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$root_dir"
docker compose --env-file .env exec -T api pnpm --filter @flowcontext/api admin enrollment create --device-id "$device_id"
