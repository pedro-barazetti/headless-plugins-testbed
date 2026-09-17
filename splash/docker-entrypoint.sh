#!/bin/sh
set -eu

: "${CRAWLERA_HOST:?CRAWLERA_HOST is required}"
: "${CRAWLERA_PORT:?CRAWLERA_PORT is required}"
: "${CRAWLERA_API_KEY:?CRAWLERA_API_KEY is required}"

profile_dir=/etc/splash/proxy-profiles
profile_path="$profile_dir/crawlera.ini"

umask 077
mkdir -p "$profile_dir"
{
  printf '%s\n' '[proxy]'
  printf 'host=%s\n' "$CRAWLERA_HOST"
  printf 'port=%s\n' "$CRAWLERA_PORT"
  printf 'username=%s\n' "$CRAWLERA_API_KEY"
  printf '%s\n' 'password='
  printf '%s\n' 'type=HTTP'
  printf '%s\n' '[rules]'
  printf '%s\n' 'whitelist=.*'
} > "$profile_path"

unset CRAWLERA_HOST CRAWLERA_PORT CRAWLERA_API_KEY

exec python3 -m splash.server \
  --proxy-profiles-path="$profile_dir" \
  "$@"
