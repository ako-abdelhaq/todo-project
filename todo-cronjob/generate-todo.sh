#!/usr/bin/env sh
set -e

START_TIME=$(date +%s)

#BACKEND_URL=${BACKEND_URL:-"http://todo-backend-svc:2345/todos"}

WIKI_URL=$(curl -s -A "TodoAppCron/1.0" -o /dev/null -w '%{redirect_url}' https://en.wikipedia.org/wiki/Special:Random)

echo "Adding todo: Read ${WIKI_URL}"

curl -s -f -X POST "$BACKEND_URL" \
  -H "Content-Type: application/json" \
  -d "{\"todo\": \"Read ${WIKI_URL}\"}"

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Added todo: 'Read ${WIKI_URL}'"
echo ""
