#!/usr/bin/env bash
# Copies the secrets from .env into the Vercel project's production variables, without printing them.
# Creates DEMO_TOKEN and ADMIN_TOKEN in .env first if they are missing. Run from the repo root: bash scripts/vercel-env.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if ! grep -q '^DEMO_TOKEN=.' .env; then
  token=$(node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))")
  printf '\n# Shared secret the app sends as Authorization: Bearer (required on Vercel)\nDEMO_TOKEN=%s\n' "$token" >> .env
  echo "DEMO_TOKEN: created in .env"
fi

# Only the presenter's phone has it (typed in Settings): it resets the demo, which DEMO_TOKEN can't
if ! grep -q '^ADMIN_TOKEN=.' .env; then
  token=$(node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))")
  printf '
# Presenter-only token: the only one that can reset the demo. Never in an app build
ADMIN_TOKEN=%s
' "$token" >> .env
  echo "ADMIN_TOKEN: created in .env"
fi

for name in AIRWALLEX_CLIENT_ID AIRWALLEX_API_KEY AIRWALLEX_BASE_URL AIRWALLEX_API_VERSION ANTHROPIC_API_KEY DEMO_TOKEN ADMIN_TOKEN; do
  value=$(grep "^$name=" .env | head -1 | cut -d= -f2- | tr -d '\r\n')
  if [ -z "$value" ]; then
    echo "$name: empty in .env, skipped"
    continue
  fi
  if printf '%s' "$value" | npx --yes vercel env add "$name" production --force >/dev/null 2>&1; then
    echo "$name: added"
  else
    echo "$name: FAILED"
  fi
done
