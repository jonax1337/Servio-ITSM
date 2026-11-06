#!/bin/sh
# "Migrate" the database once per version (like `prisma migrate deploy`, a
# restart of the same version changes nothing), then serve until stopped.
# A broken release (HEALTHY=false) also leaves what a migration killed halfway
# leaves: a hot SQLite rollback journal. Its marker outside the database proves
# it really ran, since a rollback restores only the database files.
set -e
db=/data/servio.db
grep -qx "migrated-to-$APP_VERSION" "$db" 2>/dev/null || echo "migrated-to-$APP_VERSION" >> "$db"
if [ "$HEALTHY" != true ]; then
  echo "hot-journal-of-$APP_VERSION" > "$db-journal"
  touch "/data/ran-$APP_VERSION"
fi

httpd -f -p 3000 -h /www &
server=$!
trap 'kill "$server"; exit 0' TERM INT
wait "$server"
