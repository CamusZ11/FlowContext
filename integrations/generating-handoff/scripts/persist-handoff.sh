#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: persist-handoff.sh FILE" >&2
  exit 2
fi
input=$1
if [[ ! -f "$input" ]]; then
  echo "handoff input not found" >&2
  exit 2
fi

cli=${FLOWCONTEXT_CLI:-flowcontext}
# Keep the immutable content in the protected temporary JSON file.
exec "$cli" handoff create --json "$input"
