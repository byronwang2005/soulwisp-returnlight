#!/bin/sh
set -eu
umask 077
: "${PGDATABASE:?set PGDATABASE}" "${PGUSER:?set PGUSER}"
destination=${BACKUP_DIR:-/backups}
mkdir -p "$destination"
file="$destination/wangxu-$(date -u +%Y-%m-%d).dump"
temporary="$file.tmp.$$"
trap 'rm -f "$temporary"' EXIT HUP INT TERM
if [ -n "${PG_DUMP_SNAPSHOT:-}" ]; then
  pg_dump --format=custom --snapshot="$PG_DUMP_SNAPSHOT" --file="$temporary"
else
  pg_dump --format=custom --file="$temporary"
fi
# Do not rotate valid backups if the dump or archive check failed.
pg_restore --list "$temporary" >/dev/null
mv "$temporary" "$file"
ls -1 "$destination"/wangxu-????-??-??.dump 2>/dev/null | sort -r | sed '1,7d' | while IFS= read -r old; do rm -f "$old"; done
echo "Backup ready: $file (latest seven daily archives retained)"
