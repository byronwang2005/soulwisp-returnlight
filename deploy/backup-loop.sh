#!/bin/sh
set -eu
interval=${BACKUP_INTERVAL_SECONDS:-86400}
case "$interval" in ''|*[!0-9]*) echo 'BACKUP_INTERVAL_SECONDS must be a positive integer' >&2; exit 1;; esac
[ "$interval" -gt 0 ] || exit 1
while :; do
  if ! /bin/sh /scripts/backup.sh; then echo 'Database backup failed; retry in 60 seconds' >&2; sleep 60; continue; fi
  sleep "$interval"
done
