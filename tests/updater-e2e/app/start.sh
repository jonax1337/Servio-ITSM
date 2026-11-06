#!/bin/sh
# "Migrate" the database once per version (like `prisma migrate deploy`, a
# restart of the same version changes nothing), then serve until stopped.
set -e
db=/data/servio.db
grep -qx "migrated-to-$APP_VERSION" "$db" 2>/dev/null || echo "migrated-to-$APP_VERSION" >> "$db"

httpd -f -p 3000 -h /www &
server=$!
trap 'kill "$server"; exit 0' TERM INT
wait "$server"
