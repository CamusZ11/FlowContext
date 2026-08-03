#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 || "$1" != "--fixture" ]]; then
  echo "usage: register-session.sh --fixture FILE" >&2
  exit 2
fi
fixture=$2
if [[ ! -f "$fixture" ]]; then
  echo "fixture not found" >&2
  exit 2
fi

cli=${FLOWCONTEXT_CLI:-flowcontext}
# The JSON stays in a file and is never interpolated into shell arguments.
exec "$cli" session start --json "$fixture"
