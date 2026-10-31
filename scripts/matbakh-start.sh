#!/bin/bash
# Starts MariaDB (data persisted in /app/.mysql-data) then the original Matbakh Node server on port 3000.
set -e
DATA=/app/.mysql-data
RUN=/app/.mysql-run
SOCK=$RUN/mysqld.sock

if ! command -v mariadbd >/dev/null 2>&1; then
  echo "[matbakh] installing mariadb-server"
  DEBIAN_FRONTEND=noninteractive apt-get install -y mariadb-server >/tmp/mariadb_install.log 2>&1 || \
    (apt-get update >/dev/null 2>&1 && DEBIAN_FRONTEND=noninteractive apt-get install -y mariadb-server >/tmp/mariadb_install.log 2>&1)
fi
mkdir -p "$RUN"
chown -R mysql:mysql "$DATA" "$RUN"

if ! mariadb-admin -S "$SOCK" -uroot ping >/dev/null 2>&1; then
  echo "[matbakh] starting mariadb"
  rm -f "$SOCK" "$RUN/mysqld.pid"
  nohup mariadbd --user=mysql --datadir="$DATA" --socket="$SOCK" --pid-file="$RUN/mysqld.pid" \
    --bind-address=127.0.0.1 --port=3306 >/tmp/mariadbd.log 2>&1 &
  for i in $(seq 1 60); do
    mariadb-admin -S "$SOCK" -uroot ping >/dev/null 2>&1 && break
    sleep 1
  done
fi

cd /app/matbakh
if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
  corepack prepare pnpm@10.18.0 --activate >/dev/null 2>&1 || true
fi
[ -d node_modules ] || CI=1 pnpm install --frozen-lockfile
[ -f dist/index.js ] || pnpm build

# Deadline checker (same as compose "deadline-check" service)
(while true; do sleep 60; set -a; . /app/matbakh/.env; set +a; DEADLINE_CHECK_URL=http://127.0.0.1:3000/api/maintenance/deadlines node scripts/check-deadlines.mjs >/tmp/deadlines.log 2>&1 || true; done) &

exec env PORT=3000 NODE_ENV=production node dist/index.js
