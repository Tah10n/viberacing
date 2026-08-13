#!/bin/sh
set -eu

docker compose down --volumes
exec sh scripts/local-up.sh
