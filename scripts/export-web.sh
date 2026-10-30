#!/usr/bin/env bash
# Exports the app for the web into public/, which Vercel serves next to the API. No token goes into the
# bundle: judges type it in Settings. Vercel drops node_modules folders from uploads, so the fonts and icons
# Expo puts under assets/node_modules/ move to assets/vendor/. Run from the repo root: bash scripts/export-web.sh
set -euo pipefail
cd "$(dirname "$0")/../app"

export EXPO_PUBLIC_API_URL="${EXPO_PUBLIC_API_URL:-https://contabil-pj.vercel.app}"
unset EXPO_PUBLIC_DEMO_TOKEN
npx expo export -p web --output-dir ../public --clear

mv ../public/assets/node_modules ../public/assets/vendor
grep -rlF '/assets/node_modules/' ../public --include='*.js' --include='*.html' | while read -r file; do
  sed -i 's#/assets/node_modules/#/assets/vendor/#g' "$file"
done
echo "Exported to public/ for $EXPO_PUBLIC_API_URL"
