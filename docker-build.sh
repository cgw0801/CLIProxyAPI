#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

mkdir -p data auths logs plugins
if [ ! -f data/config.yaml ]; then
  cp config.example.yaml data/config.yaml
  echo "Created data/config.yaml from config.example.yaml."
fi
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example. Set MANAGEMENT_PASSWORD before exposing the service."
fi
if ! grep -Eq '^MANAGEMENT_PASSWORD=.+' .env; then
  echo "Warning: MANAGEMENT_PASSWORD is not set in .env; the management panel will be disabled." >&2
fi

VERSION="${VERSION:-$(git describe --tags --abbrev=0 2>/dev/null || echo 0.0.4)}"
VERSION="${VERSION#v}"
COMMIT="${COMMIT:-$(git rev-parse --short HEAD 2>/dev/null || echo none)}"
BUILD_DATE="${BUILD_DATE:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
export CLI_PROXY_IMAGE="${CLI_PROXY_IMAGE:-cli-proxy-api:local}"

echo "Building ${CLI_PROXY_IMAGE}..."
docker compose build \
  --build-arg VERSION="${VERSION}" \
  --build-arg COMMIT="${COMMIT}" \
  --build-arg BUILD_DATE="${BUILD_DATE}"

docker compose up -d --remove-orphans
echo "Services are starting. Run 'docker compose logs -f' to follow the logs."
