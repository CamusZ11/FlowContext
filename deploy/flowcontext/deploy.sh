#!/bin/sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$root_dir"

./preflight.sh
docker compose --env-file .env up -d --build
docker compose ps
