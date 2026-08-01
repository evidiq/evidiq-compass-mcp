#!/usr/bin/env bash
set -euo pipefail

# Production container deployment for EVIDIQ Compass MCP (port 3019).
# Stateful service: SQLite + snapshot history live on the mounted volume —
# losing /root/evidiq-compass-data loses the moat, not just the cache (§7).
# The snapshots directory is written by the host collector
# (evidiq-compass-collect.service on the host) and only read here (§5 path B).
CONTAINER_NAME="evidiq-compass"
IMAGE_NAME="evidiq-compass:latest"
ENV_FILE="/root/evidiq-compass.env"
HOST_PORT="3019"
DATA_DIR="/root/evidiq-compass-data"

echo "Deploying ${CONTAINER_NAME} on host port ${HOST_PORT}..."

if [ ! -f "${ENV_FILE}" ]; then
  echo "Error: Environment file ${ENV_FILE} not found!"
  exit 1
fi

if [ ! -d "${DATA_DIR}/snapshots" ]; then
  mkdir -p "${DATA_DIR}/snapshots"
  chmod 700 "${DATA_DIR}"
  echo "Created data volume ${DATA_DIR}"
fi

docker stop "${CONTAINER_NAME}" 2>/dev/null || true
docker rm "${CONTAINER_NAME}" 2>/dev/null || true

docker run -d \
  --name "${CONTAINER_NAME}" \
  --restart unless-stopped \
  --network coolify \
  --env-file "${ENV_FILE}" \
  -p "127.0.0.1:${HOST_PORT}:3019" \
  -v "${DATA_DIR}:/data" \
  --label "traefik.enable=true" \
  --label "traefik.http.routers.compass.rule=Host(\`mcp.evidiq.dev\`) && PathPrefix(\`/compass\`)" \
  --label "traefik.http.routers.compass.tls=true" \
  --label "traefik.http.routers.compass.tls.certresolver=letsencrypt" \
  --label "traefik.http.routers.compass.middlewares=compass-strip" \
  --label "traefik.http.middlewares.compass-strip.stripprefix.prefixes=/compass" \
  --label "traefik.http.services.compass.loadbalancer.server.port=3019" \
  "${IMAGE_NAME}"

echo "Started ${CONTAINER_NAME}."
echo "Data volume: ${DATA_DIR} -> /data (COMPASS_DB_PATH=/data/compass.db)"
echo "Snapshots: ${DATA_DIR}/snapshots -> /data/snapshots (read by the container, written by the host collector)"
