#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
compose_file="$repo_dir/splash/dual-headless-proxy/compose.yaml"
env_file=${ENV_FILE:-"$repo_dir/.env"}

TWINDOLPHIN_CRAWLERA_API_KEY=${TWINDOLPHIN_CRAWLERA_API_KEY:-unused-for-compose-down} \
docker compose \
  --project-name splash-dual-proxy \
  --env-file "$env_file" \
  --file "$compose_file" \
  down
