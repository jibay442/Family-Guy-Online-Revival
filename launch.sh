#!/usr/bin/env sh
# Starts Family Guy Online — Revival (co-op server + game in the browser).
# Arguments are passed to the launcher, e.g. ./launch.sh --join 192.168.1.20
set -e
cd "$(dirname "$0")/revival"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required: https://nodejs.org" >&2
  exit 1
fi
[ -d node_modules/three ] && [ -d node_modules/ws ] || npm install --no-fund --no-audit
exec node launcher.mjs "$@"
