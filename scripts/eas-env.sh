#!/usr/bin/env bash
# Registers the app's EXPO_PUBLIC_* values on EAS (preview and production environments), without printing them.
# EAS builds and updates read these, not app/.env. Run from anywhere: bash scripts/eas-env.sh
set -euo pipefail
cd "$(dirname "$0")/.."

api_url=${API_URL:-https://contabil-pj.vercel.app}
token=$(grep '^DEMO_TOKEN=' .env | head -1 | cut -d= -f2- | tr -d '\r\n')
[ -n "$token" ] || { echo "DEMO_TOKEN missing in .env (run scripts/vercel-env.sh first)"; exit 1; }

cd app
for env in preview production; do
  npx --yes eas-cli env:create --environment "$env" --name EXPO_PUBLIC_API_URL --value "$api_url" \
    --visibility plaintext --non-interactive --force >/dev/null 2>&1 && echo "$env EXPO_PUBLIC_API_URL: set" || echo "$env EXPO_PUBLIC_API_URL: FAILED"
  npx --yes eas-cli env:create --environment "$env" --name EXPO_PUBLIC_DEMO_TOKEN --value "$token" \
    --visibility sensitive --non-interactive --force >/dev/null 2>&1 && echo "$env EXPO_PUBLIC_DEMO_TOKEN: set" || echo "$env EXPO_PUBLIC_DEMO_TOKEN: FAILED"
done
