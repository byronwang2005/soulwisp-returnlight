#!/bin/sh
set -eu
directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
file=${1:?Usage: sh deploy/restore.sh backup.dump EMPTY_DATABASE}
target=${2:?Usage: sh deploy/restore.sh backup.dump EMPTY_DATABASE}
case "$target" in ''|*[!a-zA-Z0-9_]*|wangxu|postgres|template0|template1) echo 'Use a newly created empty database, never the active database' >&2; exit 1;; esac
compose() { docker compose --env-file "$directory/.env" -f "$directory/compose.yaml" "$@"; }
tables=$(compose exec -T db psql -U wangxu -d "$target" -tAc "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S')")
[ "$tables" = 0 ] || { echo 'Target database is not empty' >&2; exit 1; }
compose exec -T db pg_restore -U wangxu -d "$target" --exit-on-error --single-transaction --no-owner < "$file"
echo "Restored into $target. Verify balances, account counts, and match rewards before switching the application."
