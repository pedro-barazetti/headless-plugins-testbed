#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
compose_file="$repo_dir/splash/headless-proxy/compose.yaml"
env_file=${ENV_FILE:-"$repo_dir/.env"}

if [ ! -f "$env_file" ]; then
  echo "Environment file not found: $env_file" >&2
  exit 2
fi

docker compose \
  --project-name splash-headless-proxy \
  --env-file "$env_file" \
  --file "$compose_file" \
  up --detach --build

echo "Splash: http://localhost:8052"
echo "Headless proxy: http://localhost:3129"
echo "Headless proxy stats: http://localhost:3131/stats"
