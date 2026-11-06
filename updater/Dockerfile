# Servio updater sidecar — plain Node, no dependencies, no build step.
#
# Build context is the updater/ directory (CI and release.yml pass `context: updater`).
# Runs as the unprivileged `node` user (uid 1000, the same uid as the app) and
# needs no Docker socket: it talks to a docker-socket-proxy over TCP
# (DOCKER_HOST=tcp://docker-proxy:2375, see docker-compose.release.yml).
# Exposes no ports. See updater/README.md.
FROM node:22-alpine

# Named volumes take their initial ownership from the image path they are
# mounted over. /backups is private to the updater. /data is shared with the
# app: it must exist here too, otherwise an updater that starts first would
# create the shared volume owned by root and lock the app out.
RUN mkdir -p /data /backups && chown node:node /data /backups

WORKDIR /app
ENV NODE_ENV=production \
    SERVIO_STATE_DIR=/data/state \
    BACKUP_DIR=/backups

COPY package.json ./
COPY *.mjs ./

USER node

# Healthy while the heartbeat file is fresh (written every 15 s, stale after 60 s).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "healthcheck.mjs"]

CMD ["node", "main.mjs"]
