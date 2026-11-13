#!/usr/bin/env bash
# CWI daily backup (run as root by cwi-backup.timer, 02:00 Vietnam time).
#
# Writes, all encrypted with the passphrase in /home/ubuntu/.config/cwi/backup-passphrase
# (gpg, AES-256, symmetric):
#   db/<UTC time>/cwi-db-<time>.dump.gpg     full pg_dump (custom format) of the CWI database
#   db/<UTC time>/backend-env-<time>.env.gpg the backend env file (secrets needed to rebuild)
#   db/<UTC time>/counts.txt                 row counts at dump time (plain, no personal data)
#   storage/<path>.gpg                       each Supabase Storage file (PDFs), encrypted once
#   LATEST.json                              status the pull script on the office PC reads
# Once a week the newest dump is decrypted and restored into a throw-away database to prove it
# works; counts must match. Nothing outside /home/ubuntu/cwi-backups/auto is written, and the
# only database it creates is that throw-away one, dropped at the end.
set -euo pipefail
umask 077

OWNER=ubuntu
BASE=/home/ubuntu/cwi-backups/auto
PASS=/home/ubuntu/.config/cwi/backup-passphrase
ENVF=/home/ubuntu/.config/cwi/cwi-backend.env
DB=supabase_db_supabase-cwi
VOL=/var/lib/docker/volumes/supabase_storage_supabase-cwi/_data
KEEP_DAYS=14
TS=$(date -u +%Y%m%d-%H%M%S)
OUT=$BASE/db/$TS
mkdir -p "$OUT" "$BASE/storage" "$BASE/logs"
LOG=$BASE/logs/backup-$(date -u +%Y-%m-%d).log
exec >>"$LOG" 2>&1
echo "=== $(date -u +%FT%TZ) backup $TS"

status() { # ok message
  local restore='null'
  [ -f "$BASE/restore-check.json" ] && restore=$(cat "$BASE/restore-check.json")
  cat >"$BASE/LATEST.json" <<EOF
{"time":"$(date -u +%FT%TZ)","ok":$1,"message":"$2","dir":"db/$TS","dbBytes":${DB_BYTES:-0},"storageFiles":${STORAGE_FILES:-0},"storageNew":${STORAGE_NEW:-0},"restoreCheck":$restore}
EOF
  chown -R "$OWNER:$OWNER" "$BASE"
}
trap 'echo "FAILED at line $LINENO"; status false "backup failed at line $LINENO, see logs/$(basename "$LOG")"' ERR

[ -s "$PASS" ] || { echo "missing passphrase file"; status false "missing passphrase file"; exit 1; }
enc() { gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$PASS" --symmetric --cipher-algo AES256 --compress-algo none -o "$2" "$1"; }
q() { docker exec -i "$DB" psql -U supabase_admin -d "$1" -v ON_ERROR_STOP=1 -At -F ' | ' -c "$2" </dev/null; }

COUNTS_SQL="select 'cwi_survey_submissions', count(*) from public.cwi_survey_submissions
union all select 'cwi_survey_answers', count(*) from public.cwi_survey_answers
union all select 'cwi_report_jobs', count(*) from public.cwi_report_jobs
union all select 'cwi_report_email_jobs', count(*) from public.cwi_report_email_jobs
union all select 'cwi_roundtable_registrations', count(*) from public.cwi_roundtable_registrations
union all select 'cwi_webinar_registrations', count(*) from public.cwi_webinar_registrations
union all select 'cwi_submission_report_files', count(*) from public.cwi_submission_report_files
union all select 'cwi_quarterly_report_downloads', count(*) from public.cwi_quarterly_report_downloads
union all select 'cwi_admin_users', count(*) from public.cwi_admin_users"

# 1. Database (counts first, then the dump; a submission arriving in between is fine).
q postgres "$COUNTS_SQL" >"$OUT/counts.txt"
PLAIN=$(mktemp /tmp/cwi-db-XXXXXX.dump)
docker exec "$DB" pg_dump -U supabase_admin -d postgres -Fc </dev/null >"$PLAIN"
entries=$(docker exec -i "$DB" pg_restore -l <"$PLAIN" | grep -c ' TABLE DATA ')
[ "$entries" -gt 20 ] || { echo "dump looks incomplete ($entries tables)"; false; }
enc "$PLAIN" "$OUT/cwi-db-$TS.dump.gpg"
shred -u "$PLAIN"
enc "$ENVF" "$OUT/backend-env-$TS.env.gpg"
(cd "$OUT" && sha256sum ./*.gpg >SHA256SUMS)
DB_BYTES=$(stat -c %s "$OUT/cwi-db-$TS.dump.gpg")
echo "db dump: $entries tables, $DB_BYTES bytes encrypted"

# 2. Storage: encrypt each file once (files are immutable object versions).
STORAGE_FILES=0; STORAGE_NEW=0
while IFS= read -r -d '' file; do
  rel=${file#"$VOL"/}
  target="$BASE/storage/$rel.gpg"
  STORAGE_FILES=$((STORAGE_FILES + 1))
  if [ ! -s "$target" ] || [ "$file" -nt "$target" ]; then
    mkdir -p "$(dirname "$target")"
    enc "$file" "$target.part" && mv "$target.part" "$target"
    STORAGE_NEW=$((STORAGE_NEW + 1))
  fi
done < <(find "$VOL" -type f -print0)
echo "storage: $STORAGE_FILES files, $STORAGE_NEW newly encrypted"

# 3. Retention on the server (the office PC keeps a longer history).
find "$BASE/db" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +
find "$BASE/logs" -type f -mtime +60 -delete

# 4. Weekly restore test (Sundays, or when the last one is older than 7 days).
last_check=$(stat -c %Y "$BASE/restore-check.json" 2>/dev/null || echo 0)
if [ "$(date -u +%u)" = 7 ] || [ $(( $(date +%s) - last_check )) -gt $((7 * 86400)) ]; then
  R="cwi_restore_check_$(date -u +%Y%m%d%H%M%S)"
  DEC=$(mktemp /tmp/cwi-restore-XXXXXX.dump)
  gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$PASS" -d -o "$DEC" --yes "$OUT/cwi-db-$TS.dump.gpg"
  q postgres "create database $R" >/dev/null
  q "$R" "create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; create extension if not exists \"uuid-ossp\" with schema extensions; create extension if not exists pg_trgm with schema extensions;" >/dev/null
  docker exec -i "$DB" pg_restore -U supabase_admin -d "$R" -n public --no-owner <"$DEC" >/dev/null 2>&1 || true
  q "$R" "$COUNTS_SQL" >"/tmp/$R.counts"
  q postgres "drop database $R" >/dev/null
  shred -u "$DEC"
  # Counts were taken just before the dump, so a row added in between may appear in the dump:
  # every table must have at least the recorded rows (and the same set of tables).
  if awk -F ' [|] ' 'NR==FNR { want[$1]=$2; next } { got[$1]=$2 } END { for (t in want) if (!(t in got) || got[t] < want[t]) exit 1; for (t in got) if (!(t in want)) exit 1 }' "$OUT/counts.txt" "/tmp/$R.counts"; then ok=true; else ok=false; fi
  rm -f "/tmp/$R.counts"
  echo "{\"time\":\"$(date -u +%FT%TZ)\",\"ok\":$ok,\"dump\":\"db/$TS\"}" >"$BASE/restore-check.json"
  echo "restore check: $ok"
fi

trap - ERR
status true "ok"
echo "=== done $(date -u +%FT%TZ)"
