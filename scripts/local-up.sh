#!/bin/sh
set -eu

if [ ! -f apps/web/.env.local ]; then
  echo "apps/web/.env.local is required; copy .env.example and add local GitHub OAuth values." >&2
  exit 1
fi

docker compose up --build --detach

web_port="${VIBERACING_LOCAL_WEB_PORT:-3000}"
attempt=0
while [ "$attempt" -lt 60 ]; do
  if curl --fail --silent "http://127.0.0.1:${web_port}/ready" >/dev/null; then
    echo "Vibe Racing is ready at http://localhost:${web_port} (PostgreSQL: 127.0.0.1:${VIBERACING_LOCAL_DATABASE_PORT:-55432})"
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 1
done

docker compose logs web >&2
echo "Vibe Racing did not become ready within 60 seconds." >&2
exit 1
