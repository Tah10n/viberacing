#!/bin/sh
set -eu

postgres_bin="$(pg_config --bindir)"
mkdir -p "$PGDATA" /run/postgresql
chown -R postgres:postgres "$PGDATA" /run/postgresql

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  runuser -u postgres -- "$postgres_bin/initdb" \
    --auth=trust \
    --encoding=UTF8 \
    --no-locale \
    --pgdata="$PGDATA"
fi

runuser -u postgres -- "$postgres_bin/pg_ctl" \
  --pgdata="$PGDATA" \
  --log="$PGDATA/postgres.log" \
  --options="-c listen_addresses=127.0.0.1" \
  --wait start

if ! runuser -u postgres -- psql --tuples-only \
  --command="SELECT 1 FROM pg_database WHERE datname = 'viberacing'" | grep --quiet 1; then
  runuser -u postgres -- createdb viberacing
fi

node scripts/migrate.mjs

web_pid=""
shutdown() {
  if [ -n "$web_pid" ]; then
    kill -TERM "$web_pid" 2>/dev/null || true
  fi
  runuser -u postgres -- "$postgres_bin/pg_ctl" --pgdata="$PGDATA" --mode=fast --wait stop \
    2>/dev/null || true
}
trap shutdown INT TERM EXIT

runuser -u node --preserve-environment -- node server.js &
web_pid=$!
wait "$web_pid"
