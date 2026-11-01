#!/bin/bash
# Starts MariaDB (data persisted in /app/.mysql-data) then the original Matbakh Node server on port 3000.
DATA=/app/.mysql-data
RUN=/app/.mysql-run
SOCK=$RUN/mysqld.sock
DEBS=/app/.mariadb-debs

if ! command -v mariadbd >/dev/null 2>&1; then
  echo "[matbakh] installing mariadb-server from local cache"
  DEBIAN_FRONTEND=noninteractive dpkg -i --force-confold "$DEBS"/*.deb >/tmp/mariadb_install.log 2>&1 || true
  if ! command -v mariadbd >/dev/null 2>&1; then
    echo "[matbakh] cache install failed, using apt"
    apt-get update >/dev/null 2>&1
    DEBIAN_FRONTEND=noninteractive apt-get install -y mariadb-server >>/tmp/mariadb_install.log 2>&1
  fi
fi

db_up() { mariadb-admin -S "$SOCK" -uroot ping >/dev/null 2>&1; }
start_db() {
  mkdir -p "$RUN"
  chown -R mysql:mysql "$DATA" "$RUN"
  rm -f "$SOCK" "$RUN/mysqld.pid"
  nohup mariadbd --user=mysql --datadir="$DATA" --socket="$SOCK" --pid-file="$RUN/mysqld.pid" \
    --bind-address=127.0.0.1 --port=3306 >>/tmp/mariadbd.log 2>&1 &
}

if ! db_up; then
  echo "[matbakh] starting mariadb"
  start_db
fi
for i in $(seq 1 180); do db_up && break; sleep 1; done
db_up && echo "[matbakh] mariadb ready" || echo "[matbakh] WARNING mariadb not ready yet"

# Watchdog: bring MariaDB back if it ever stops.
(misses=0; while true; do sleep 15
  if db_up; then misses=0; else misses=$((misses+1)); fi
  if [ "$misses" -ge 2 ]; then echo "[matbakh] mariadb down, restarting"; start_db; misses=-4; fi
done) &

cd /app/matbakh
if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
  corepack prepare pnpm@10.18.0 --activate >/dev/null 2>&1 || true
fi
[ -d node_modules ] || CI=1 pnpm install --frozen-lockfile
[ -f dist/index.js ] || pnpm build

# Deadline checker (same as compose "deadline-check" service)
(while true; do sleep 60; DEADLINE_CHECK_URL=http://127.0.0.1:3000/api/maintenance/deadlines node scripts/check-deadlines.mjs >/tmp/deadlines.log 2>&1 || true; done) &

exec env PORT=3000 NODE_ENV=production node dist/index.js
