#!/usr/bin/env bash
# Store Mail's two secrets in SSM, never printing them (SPEC.md):
#
#   scripts/set-secrets.sh
#
#   GOOGLE_CLIENT_SECRET  from .env (the whitebirch-mail OAuth client)
#   SESSION_KEY           from .env, generated if missing (32 bytes,
#                         base64url); rotating it signs everyone out
#
# Mail re-reads SSM within 15 minutes, so no deploy is needed.
set -euo pipefail
cd "$(dirname "$0")/.."

touch .env
chmod 600 .env
read_env() { sed -n "s/^$1=//p" .env | sed -e "s/^[\"']//" -e "s/[\"']$//"; }

secret="$(read_env GOOGLE_CLIENT_SECRET)"
[ -n "$secret" ] || { echo "GOOGLE_CLIENT_SECRET is not set in .env (docs/SETUP.md, Google Cloud)" >&2; exit 1; }
printf '%s' "$secret" | scripts/put-ssm-secret.sh /mail/production/GOOGLE_CLIENT_SECRET

key="$(read_env SESSION_KEY)"
if [ -z "$key" ]; then
  key="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')"
  if grep -q '^SESSION_KEY=' .env; then sed -i.bak "s/^SESSION_KEY=.*/SESSION_KEY=$key/" .env && rm -f .env.bak; else printf 'SESSION_KEY=%s\n' "$key" >> .env; fi
  echo "  generated SESSION_KEY in .env"
fi
printf '%s' "$key" | scripts/put-ssm-secret.sh /mail/production/SESSION_KEY
