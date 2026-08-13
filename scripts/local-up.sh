#!/bin/sh
set -eu

if [ ! -f apps/web/.env.local ]; then
  echo "apps/web/.env.local is required; copy .env.example and add local GitHub OAuth values." >&2
  exit 1
fi

docker build --quiet --tag viberacing:local-web .
docker build --quiet --file docker/local.Dockerfile --tag viberacing:local-one-container .

if docker container inspect viberacing-local >/dev/null 2>&1; then
  docker rm --force viberacing-local >/dev/null
fi

docker run --detach \
  --name viberacing-local \
  --publish 3000:3000 \
  --volume viberacing-local-data:/var/lib/postgresql/data \
  --env-file apps/web/.env.local \
  viberacing:local-one-container

echo "Vibe Racing is starting at http://localhost:3000"
