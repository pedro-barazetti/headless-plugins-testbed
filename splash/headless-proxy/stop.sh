#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
compose_file="$repo_dir/splash/headless-proxy/compose.yaml"
env_file=${ENV_FILE:-"$repo_dir/.env"}

docker compose \
  --project-name splash-headless-proxy \
  --env-file "$env_file" \
  --file "$compose_file" \
  down
