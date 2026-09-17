#!/bin/sh
set -eu

container=${SPLASH_CONTAINER_NAME:-splash-crawlera}

if ! docker container inspect "$container" >/dev/null 2>&1; then
  echo "Splash container $container does not exist"
  exit 0
fi

if [ "$(docker inspect --format '{{.State.Running}}' "$container")" = "true" ]; then
  docker stop "$container" >/dev/null
fi

docker rm "$container" >/dev/null
echo "Stopped and removed Splash container $container"
