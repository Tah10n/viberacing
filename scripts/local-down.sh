#!/bin/sh
set -eu

if docker container inspect viberacing-local >/dev/null 2>&1; then
  docker stop viberacing-local >/dev/null
  echo "Vibe Racing stopped. The local database volume was kept."
else
  echo "Vibe Racing is not running."
fi
