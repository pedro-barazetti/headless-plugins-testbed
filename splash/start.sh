#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
env_file=${ENV_FILE:-"$repo_dir/.env"}
image=${SPLASH_IMAGE:-splash-crawlera:local}
container=${SPLASH_CONTAINER_NAME:-splash-crawlera}

if [ ! -f "$env_file" ]; then
  echo "Environment file not found: $env_file" >&2
  exit 2
fi

read_env_value() {
  variable_name=$1
  sed -n "s/^${variable_name}=//p" "$env_file" | head -n 1 | tr -d '\r'
}

crawlera_host=$(read_env_value CRAWLERA_HOST)
crawlera_port=$(read_env_value CRAWLERA_PORT)
crawlera_api_key=$(read_env_value CRAWLERA_API_KEY)

if [ -z "$crawlera_host" ] || [ -z "$crawlera_port" ] || [ -z "$crawlera_api_key" ]; then
  echo "CRAWLERA_HOST, CRAWLERA_PORT, and CRAWLERA_API_KEY must be set in $env_file" >&2
  exit 2
fi

if ! docker image inspect "$image" >/dev/null 2>&1; then
  echo "Splash image $image is missing. Run: npm run splash-build" >&2
  exit 2
fi

if docker container inspect "$container" >/dev/null 2>&1; then
  if [ "$(docker inspect --format '{{.State.Running}}' "$container")" = "true" ]; then
    echo "Splash container $container is already running at http://localhost:8050"
    exit 0
  fi

  docker start "$container" >/dev/null
  echo "Started existing Splash container $container at http://localhost:8050"
  exit 0
fi

docker run -d \
  --name "$container" \
  -p 127.0.0.1:8050:8050 \
  -e CRAWLERA_HOST="$crawlera_host" \
  -e CRAWLERA_PORT="$crawlera_port" \
  -e CRAWLERA_API_KEY="$crawlera_api_key" \
  "$image" >/dev/null

echo "Started Splash container $container at http://localhost:8050"
