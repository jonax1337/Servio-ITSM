#!/usr/bin/env bash
# End-to-end test of the updater against a real Docker engine (CI job
# updater-e2e). Runs the real updater image behind the real socket proxy, as
# configured in docker-compose.release.yml, with a local registry and a
# stand-in app (tests/updater-e2e/app):
#   1. 1.0.0 -> 1.1.0 must end SUCCEEDED, 1.1.0 serving, the old container gone.
#   2. 1.1.0 -> 1.2.0 (health check always fails) must end ROLLED_BACK with the
#      same 1.1.0 container running and the database restored byte for byte.
# The proxy must refuse calls outside its allowlist and host bind mounts.
set -euo pipefail
cd "$(dirname "$0")/../.."

REPO=localhost:5000/servio-e2e
BUSYBOX=busybox:1.37.0
COMPOSE=(docker compose -f docker-compose.release.yml -f tests/updater-e2e/compose.override.yml)
DOCKER_GID=$(stat -c %g /var/run/docker.sock)
export DOCKER_GID

fail() {
  echo "::error::$*"
  exit 1
}

diagnose() {
  echo "----- diagnostics -----"
  docker ps -a || true
  "${COMPOSE[@]}" logs --no-color updater docker-proxy || true
  docker logs servio-web || true
  in_data cat /data/state/updater/status.json || true
}
trap 'rc=$?; ((rc == 0)) || diagnose' EXIT

in_data() { docker run --rm -v servio_servio-data:/data:ro "$BUSYBOX" "$@"; }
in_backups() { docker run --rm -v servio_servio-backups:/backups:ro "$BUSYBOX" "$@"; }
inspect_web() { docker inspect --format "$1" servio-web; }
web_is_healthy() { [[ $(inspect_web '{{.State.Health.Status}}') == healthy ]]; }
updater_is_healthy() { [[ $(docker inspect --format '{{.State.Health.Status}}' "$("${COMPOSE[@]}" ps -q updater)") == healthy ]]; }
heartbeat_reports_docker() { in_data cat /data/state/updater/heartbeat.json | jq -e '.dockerOk == true'; }

# wait_for <seconds> <description> <command...>: polls once a second.
wait_for() {
  local deadline=$((SECONDS + $1)) what=$2
  shift 2
  until "$@" >/dev/null 2>&1; do
    ((SECONDS < deadline)) || fail "timed out waiting for $what"
    sleep 1
  done
}

build_release() { # <version> <healthy>
  docker build --quiet --tag "$REPO:$1" --build-arg VERSION="$1" --build-arg HEALTHY="$2" tests/updater-e2e/app
  docker push --quiet "$REPO:$1"
}

# Writes request.json the way the app does: as uid 1000, atomically, from inside the app container.
request_update() { # <id> <version>
  printf '{"id":"%s","targetVersion":"%s","requestedAt":"%s","requestedBy":"ci"}' "$1" "$2" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" |
    docker exec -i servio-web sh -c 'cat > /data/state/updater/request.json.tmp && mv /data/state/updater/request.json.tmp /data/state/updater/request.json'
}

status_is_terminal() { # <id>
  in_data cat /data/state/updater/status.json |
    jq -e --arg id "$1" '.id == $id and (.state | IN("SUCCEEDED", "FAILED", "ROLLED_BACK"))'
}

expect_status() { # <id> <state>
  wait_for 180 "request $1 to finish" status_is_terminal "$1"
  local state
  state=$(in_data cat /data/state/updater/status.json | jq -r .state)
  in_data cat /data/state/updater/status.json | jq -r '.log[] | "  \(.at) \(.state): \(.message)"'
  [[ $state == "$2" ]] || fail "request $1 ended $state, expected $2"
}

# Calls the filtered Docker API from inside the updater container: prints the HTTP status.
proxy_call() { # <method> <path> [json body]
  "${COMPOSE[@]}" exec -T updater node -e '
    const [method, path, body] = process.argv.slice(1);
    const request = require("node:http").request(
      { socketPath: "/run/docker-api/docker.sock", method, path, headers: body ? { "Content-Type": "application/json" } : {} },
      (response) => { console.log(response.statusCode); response.resume(); },
    );
    request.on("error", (error) => console.log(`error ${error.message}`));
    request.end(body);
  ' "$@"
}

echo "== registry and releases"
docker run --detach --name e2e-registry --publish 5000:5000 registry:2.8.3 >/dev/null
wait_for 30 "the registry" curl -fsS http://localhost:5000/v2/
build_release 1.0.0 true
build_release 1.1.0 true
build_release 1.2.0 false
# The updater must really pull the new releases.
docker image rm "$REPO:1.1.0" "$REPO:1.2.0" >/dev/null
docker build --quiet --tag servio-updater:e2e updater

echo "== stack"
"${COMPOSE[@]}" up --detach web docker-proxy updater
wait_for 60 "web to be healthy" web_is_healthy
wait_for 60 "the updater heartbeat" heartbeat_reports_docker

echo "== socket proxy allowlist"
[[ $(proxy_call GET /_ping) == 200 ]] || fail "the proxy refused /_ping"
[[ $(proxy_call GET /v1.44/containers/servio-web/json) == 200 ]] || fail "the proxy refused container inspect"
for call in "GET /v1.44/info" "GET /v1.44/containers/servio-web/logs" "POST /v1.44/containers/servio-web/exec" "POST /v1.44/volumes/create" "DELETE /v1.44/images/$REPO:1.0.0"; do
  # shellcheck disable=SC2086 # method and path are meant to split
  status=$(proxy_call $call)
  [[ $status == 403 || $status == 405 ]] || fail "the proxy allowed $call ($status)"
done
status=$(proxy_call POST /v1.44/containers/create '{"Image":"e2e/none:0","HostConfig":{"Binds":["/etc:/host-etc"]}}')
[[ $status == 403 ]] || fail "the proxy allowed a host bind mount ($status)"
socket_mode=$("${COMPOSE[@]}" exec -T updater node -e 'const s = require("node:fs").statSync("/run/docker-api/docker.sock"); console.log((s.mode & 0o777).toString(8), s.uid)')
[[ $socket_mode == "600 1000" ]] || fail "filtered socket has mode/owner $socket_mode, expected 600 1000"

echo "== update 1.0.0 -> 1.1.0"
request_update e2e-1 1.1.0
expect_status e2e-1 SUCCEEDED
[[ $(inspect_web '{{index .Config.Labels "org.opencontainers.image.version"}} {{.State.Running}}') == "1.1.0 true" ]] || fail "1.1.0 is not serving"
[[ $(inspect_web '{{.HostConfig.RestartPolicy.Name}}') == unless-stopped ]] || fail "the new container lost the restart policy"
! docker inspect servio-web-pre-1.0.0 >/dev/null 2>&1 || fail "the previous container was not removed"
in_data grep -qx migrated-to-1.1.0 /data/servio.db || fail "1.1.0 did not migrate the database"

serving_id=$(inspect_web '{{.Id}}')
database_sha=$(in_data sha256sum /data/servio.db)

echo "== update 1.1.0 -> 1.2.0 (broken release)"
request_update e2e-2 1.2.0
expect_status e2e-2 ROLLED_BACK
[[ $(inspect_web '{{.Id}}') == "$serving_id" ]] || fail "a different container serves after the rollback"
[[ $(inspect_web '{{index .Config.Labels "org.opencontainers.image.version"}} {{.State.Running}}') == "1.1.0 true" ]] || fail "1.1.0 is not running after the rollback"
[[ $(inspect_web '{{.HostConfig.RestartPolicy.Name}}') == unless-stopped ]] || fail "the rollback did not restore the restart policy"
[[ $(in_data sha256sum /data/servio.db) == "$database_sha" ]] || fail "the database was not restored byte for byte"
[[ -z $(docker ps -aq --filter label=org.opencontainers.image.version=1.2.0) ]] || fail "the 1.2.0 container was left behind"
in_backups ls -a /backups | grep -q '^servio-1.1.0-.*\.db$' || fail "no backup of 1.1.0"
! in_backups ls -a /backups | grep -q '^\.journal' || fail "a journal was left behind"

echo "== updater container health (liveness stamp on /backups)"
wait_for 90 "the updater to be healthy" updater_is_healthy

echo "updater e2e: all checks passed"
