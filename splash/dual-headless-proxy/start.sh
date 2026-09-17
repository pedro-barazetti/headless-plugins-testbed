#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
compose_file="$repo_dir/splash/dual-headless-proxy/compose.yaml"
env_file=${ENV_FILE:-"$repo_dir/.env"}

if [ ! -f "$env_file" ]; then
  echo "Environment file not found: $env_file" >&2
  exit 2
fi

docker compose \
  --project-name splash-dual-proxy \
  --env-file "$env_file" \
  --file "$compose_file" \
  up --detach --build

ready=0
attempt=1
while [ "$attempt" -le 20 ]; do
  if curl --silent --fail http://127.0.0.1:8052/_ping >/dev/null \
    && curl --silent --fail http://127.0.0.1:8053/_ping >/dev/null \
    && curl --silent --fail http://127.0.0.1:3131/stats >/dev/null \
    && curl --silent --fail http://127.0.0.1:3133/stats >/dev/null; then
    ready=1
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  echo "The comparison stack did not become ready" >&2
  docker compose \
    --project-name splash-dual-proxy \
    --env-file "$env_file" \
    --file "$compose_file" \
    ps >&2
  exit 1
fi

echo "Default:     Splash http://localhost:8052, proxy http://localhost:3129, stats http://localhost:3131/stats"
echo "Twindolphin: Splash http://localhost:8053, proxy http://localhost:3132, stats http://localhost:3133/stats"
