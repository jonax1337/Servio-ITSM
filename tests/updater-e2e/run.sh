#!/usr/bin/env bash
# End-to-end test of the updater against a real Docker engine (CI job
# updater-e2e). Runs the real updater image behind the real socket proxy, as
# configured in docker-compose.release.yml, with a local registry and a
# stand-in app (tests/updater-e2e/app):
#   1. 1.0.0 -> 1.1.0 must end SUCCEEDED, 1.1.0 serving, the old container gone,
#      and the updater must then replace itself with its own 1.1.0 release (same
#      name and configuration); the new updater removes the previous one and
#      cleans up superseded updater images, keeping 1.0.0 as rollback target.
#   2. 1.1.0 -> 1.2.0 (health check always fails), with the socket proxy killed
#      and started again while the updater waits for the health check, must end
#      ROLLED_BACK with the same 1.1.0 container running and the database
#      restored byte for byte.
#   3. 1.1.0 -> 1.3.0 (broken, slow to fail) with the updater killed during
#      HEALTH_CHECK must end ROLLED_BACK through start-up recovery.
#   4. 1.1.0 -> 1.4.0 must end SUCCEEDED with the new container referencing
#      the image by tag, report SUCCEEDED before the image cleanup and add the
#      cleanup as a note, keep the replaced 1.1.0 image (rollback target), keep
#      1.2.0 (a container uses it) and 1.3.0 (two tags, one of them used by a
#      container: neither tag may be removed), and remove the superseded 1.0.0.
#      Every pre-pull space check leaves a line (measured and required bytes) in
#      the update log and the updater's container log.
#      The self-update to the updater's 1.4.0 release (broken: it runs but never
#      reports a heartbeat) must roll back to the running 1.1.0 updater.
#   5. The updater's own repository follows the same rules: at start-up and after
#      an update its superseded images go, except the running updater release and
#      the newest older one (the rollback target, UPDATER_KEEP_IMAGES=1).
# The proxy must refuse calls outside its allowlist and host bind mounts.
set -euo pipefail
cd "$(dirname "$0")/../.."

REPO=localhost:5000/servio-e2e
# The proxy's image rules are built from this pattern (docker-compose.release.yml).
SERVIO_IMAGE_PATTERN='localhost:5000/servio-e2e'
export SERVIO_IMAGE_PATTERN
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
  "${COMPOSE[@]}" logs --no-color docker-proxy || true
  docker logs servio-updater || true
  docker logs servio-updater-pre-1.0.0 || true
  docker logs servio-updater-pre-1.1.0 || true
  docker logs servio-web || true
  in_data cat /data/state/updater/status.json /data/state/updater/heartbeat.json || true
  in_backups sh -c 'ls -a /backups; cat /backups/.self-update*.json' || true
}
trap 'rc=$?; ((rc == 0)) || diagnose' EXIT

in_data() { docker run --rm -v servio_servio-data:/data:ro "$BUSYBOX" "$@"; }
in_backups() { docker run --rm -v servio_servio-backups:/backups:ro "$BUSYBOX" "$@"; }
inspect_web() { docker inspect --format "$1" servio-web; }
web_is_healthy() { [[ $(inspect_web '{{.State.Health.Status}}') == healthy ]]; }
# A fixed name (container_name in docker-compose.release.yml): the updater replaces its own container under it.
inspect_updater() { docker inspect --format "$1" servio-updater; }
updater_id() { inspect_updater '{{.Id}}'; }
updater_is_healthy() { [[ $(inspect_updater '{{.State.Health.Status}}') == healthy ]]; }
updater_runs() { [[ $(inspect_updater '{{.Config.Image}} {{.State.Running}}') == "$REPO-updater:$1 true" ]]; }
no_container() { ! docker inspect "$1" >/dev/null 2>&1; }
heartbeat_matches() { in_data cat /data/state/updater/heartbeat.json | jq -e "$1"; }
status_mentions() { in_data cat /data/state/updater/status.json | jq -e --arg text "$1" '.message | contains($text)'; }
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

build_release() { # <version> <healthy> [build target]
  docker build --quiet --target "${3:-release}" --tag "$REPO:$1" --build-arg VERSION="$1" --build-arg HEALTHY="$2" tests/updater-e2e/app
  docker push --quiet "$REPO:$1"
}

# A stand-in release of the updater's own repository (distinct image id per version).
build_updater_release() { # <version>
  printf 'FROM %s\nLABEL org.opencontainers.image.version=%s\n' "$BUSYBOX" "$1" | docker build --quiet --tag "$REPO-updater:$1" - >/dev/null
}
# A real updater release built from this source that reports <version> (package.json and label).
# With a CMD it is broken: it runs, but never writes a heartbeat.
build_updater_from_source() { # <version> [CMD as JSON]
  {
    printf 'FROM servio-updater:e2e\nARG VERSION\nUSER root\n'
    # shellcheck disable=SC2016 # the quotes are for the Dockerfile's shell, not this one
    echo 'RUN node -e "const fs = require(\"node:fs\"); const p = JSON.parse(fs.readFileSync(\"package.json\")); p.version = process.env.VERSION; fs.writeFileSync(\"package.json\", JSON.stringify(p))"'
    printf 'USER node\nLABEL org.opencontainers.image.version=%s\n' "$1"
    if [[ -n ${2:-} ]]; then printf 'CMD %s\n' "$2"; fi
  } | docker build --quiet --build-arg VERSION="$1" --tag "$REPO-updater:$1" - >/dev/null
}
updater_image_exists() { docker image inspect "$REPO-updater:$1" >/dev/null 2>&1; }

# Not `grep -q`: with pipefail, a grep that stops reading early fails the pipeline.
updater_logged() { docker logs "$(updater_id)" 2>&1 | grep -F "$1" >/dev/null; }
updater_log_count() { docker logs "$(updater_id)" 2>&1 | grep -cF "$1" || true; }

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
  docker exec -i servio-updater node -e '
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
build_release 1.3.0 false slow-to-fail
build_release 1.4.0 true
# The updater must really pull the new releases.
docker image rm "$REPO:1.1.0" "$REPO:1.2.0" "$REPO:1.3.0" "$REPO:1.4.0" >/dev/null
docker build --quiet --tag servio-updater:e2e updater
# The running updater release (1.0.0, see compose.override.yml) and two older ones in the
# updater's own repository. The app releases 1.1.0 and 1.4.0 come with updater releases of
# the same version in the registry (1.4.0 broken), which the self-update must pull.
updater_version=1.0.0
build_updater_from_source "$updater_version"
build_updater_release 0.0.1
build_updater_release 0.0.2
build_updater_from_source 1.1.0
build_updater_from_source 1.4.0 '["node", "-e", "setInterval(() => {}, 1 << 30)"]'
for version in 1.1.0 1.4.0; do
  docker push --quiet "$REPO-updater:$version" >/dev/null
  docker image rm "$REPO-updater:$version" >/dev/null
done

echo "== stack"
"${COMPOSE[@]}" up --detach web docker-proxy updater
wait_for 60 "web to be healthy" web_is_healthy
wait_for 60 "the updater heartbeat" heartbeat_reports_docker

echo "== updater images: cleanup at start-up"
wait_for 60 "the start-up cleanup of updater images" updater_logged "Removed superseded images: $REPO-updater:0.0.1."
! updater_image_exists 0.0.1 || fail "the superseded updater image 0.0.1 was not removed at start-up"
updater_image_exists 0.0.2 || fail "the newest older updater image (rollback target) was removed"
updater_image_exists "$updater_version" || fail "the running updater image lost its tag"

echo "== socket proxy allowlist"
[[ $(proxy_call GET /_ping) == 200 ]] || fail "the proxy refused /_ping"
[[ $(proxy_call GET /v1.44/containers/servio-web/json) == 200 ]] || fail "the proxy refused container inspect"
[[ $(proxy_call GET /v1.44/containers/servio-updater/json) == 200 ]] || fail "the proxy refused inspecting the updater's own container"
web_id=$(inspect_web '{{.Id}}')
[[ $(proxy_call GET "/v1.44/containers/$web_id/json") == 200 ]] || fail "the proxy refused container inspect by full id"
[[ $(proxy_call GET "/v1.44/images/$REPO:1.0.0/json") == 200 ]] || fail "the proxy refused inspecting a managed image by tag"
[[ $(proxy_call GET "/v1.44/images/$(inspect_web '{{.Image}}')/json") == 200 ]] || fail "the proxy refused inspecting an image by id"
[[ $(proxy_call GET /v1.44/images/json) == 200 ]] || fail "the proxy refused listing images"
# Unrelated containers stay out of reach: no list, no inspect/stop/rename/remove by name, no short-id
# prefixes. A full id of a foreign container still passes the path filter; the updater just cannot learn one.
# Images: only the managed repositories, removal only by reference (never by id).
busybox_id=$(docker image inspect --format '{{.Id}}' "$BUSYBOX")
for call in "GET /v1.44/info" "GET /v1.44/x/_ping" "GET /v1.44/containers/servio-web/logs" "POST /v1.44/containers/servio-web/exec" \
  "POST /v1.44/volumes/create" "DELETE /v1.44/images/$BUSYBOX" "DELETE /v1.44/images/$busybox_id" \
  "GET /v1.44/images/$BUSYBOX/json" "DELETE /v1.44/images/$REPO-other:1.0.0" "POST /v1.44/images/$REPO:1.0.0/tag" \
  "GET /v1.44/containers/json" "GET /v1.44/containers/e2e-registry/json" "POST /v1.44/containers/e2e-registry/stop" \
  "POST /v1.44/containers/e2e-registry/rename" "DELETE /v1.44/containers/e2e-registry" \
  "GET /v1.44/containers/servio-updater-other/json" "POST /v1.44/containers/servio-updater/exec" \
  "GET /v1.44/containers/${web_id:0:12}/json"; do
  # shellcheck disable=SC2086 # method and path are meant to split
  status=$(proxy_call $call)
  [[ $status == 403 || $status == 405 ]] || fail "the proxy allowed $call ($status)"
done
for body in '{"Image":"e2e/none:0","HostConfig":{"Binds":["/etc:/host-etc"]}}' \
  '{"Image":"e2e/none:0","HostConfig":{"Mounts":[{"Type":"bind","Source":"/etc","Target":"/x"}]}}' \
  '{"Image":"e2e/none:0","HostConfig":{"Binds":["/servio-no-host-binds/../etc:/x"]}}'; do
  status=$(proxy_call POST /v1.44/containers/create "$body")
  [[ $status == 403 ]] || fail "the proxy allowed a host bind mount ($status): $body"
done
socket_mode=$(docker exec servio-updater node -e '
  const fs = require("node:fs");
  const describe = (path) => { const s = fs.statSync(path); return `${(s.mode & 0o777).toString(8)} ${s.uid}:${s.gid}`; };
  console.log(describe("/run/docker-api"), describe("/run/docker-api/docker.sock"));
')
[[ $socket_mode == "750 64999:64999 660 64999:64999" ]] || fail "filtered socket directory/socket are $socket_mode"

echo "== update 1.0.0 -> 1.1.0"
request_update e2e-1 1.1.0
expect_status e2e-1 SUCCEEDED
[[ $(inspect_web '{{index .Config.Labels "org.opencontainers.image.version"}} {{.State.Running}}') == "1.1.0 true" ]] || fail "1.1.0 is not serving"
[[ $(inspect_web '{{.HostConfig.RestartPolicy.Name}}') == unless-stopped ]] || fail "the new container lost the restart policy"
in_data cat /data/state/updater/status.json |
  jq -e '[.log[] | select(.message | startswith("Free space for the pull: "))] | length == 1 and (.[0].message | test("free on the filesystem of /backups .* needed for .*:1[.]1[.]0 [(]"))' >/dev/null ||
  fail "the update log has no line for the free-space check"
! docker inspect servio-web-pre-1.0.0 >/dev/null 2>&1 || fail "the previous container was not removed"
in_data grep -qx migrated-to-1.1.0 /data/servio.db || fail "1.1.0 did not migrate the database"

echo "== updater self-update 1.0.0 -> 1.1.0"
wait_for 120 "the updater to replace itself with 1.1.0" updater_runs 1.1.0
wait_for 60 "the new updater to remove the previous one" no_container servio-updater-pre-1.0.0
updater_config() { inspect_updater '{{.HostConfig.RestartPolicy.Name}} {{.HostConfig.ReadonlyRootfs}} {{.HostConfig.NetworkMode}} {{.HostConfig.GroupAdd}}'; }
[[ $(updater_config) == "unless-stopped true none [64999]" ]] || fail "the new updater lost its configuration: $(updater_config)"
wait_for 60 "the heartbeat of the 1.1.0 updater" \
  heartbeat_matches '.updaterVersion == "1.1.0" and .selfUpdate.state == "SUCCEEDED" and .selfUpdate.fromVersion == "1.0.0"'
status_mentions "The updater updated itself from 1.0.0 to 1.1.0" >/dev/null || fail "the update status does not report the self-update"
wait_for 90 "the new updater to be healthy" updater_is_healthy
[[ $(proxy_call GET /_ping) == 200 ]] || fail "the new updater cannot reach the proxy"
# Its start-up cleanup: the previous updater release stays as rollback target, older ones go.
updater_image_gone() { ! updater_image_exists "$1"; }
wait_for 60 "the new updater's cleanup of updater images" updater_image_gone 0.0.2
updater_image_exists 1.0.0 || fail "the previous updater image (rollback target) was removed"

serving_id=$(inspect_web '{{.Id}}')
database_sha=$(in_data sha256sum /data/servio.db)

echo "== update 1.1.0 -> 1.2.0 (broken release), socket proxy killed during HEALTH_CHECK"
proxy=$("${COMPOSE[@]}" ps --quiet docker-proxy)
outages_before=$(updater_log_count "Docker is not answering")
request_update e2e-2 1.2.0
wait_for 120 "the updater to wait for 1.2.0's health check" updater_logged "HEALTH_CHECK: Waiting for servio-web ($REPO:1.2.0)"
# No restart policy while it is down, so the outage lasts until the updater notices.
docker update --restart no "$proxy" >/dev/null
docker kill "$proxy" >/dev/null
noticed_outage() { (($(updater_log_count "Docker is not answering") > outages_before)); }
wait_for 30 "the updater to notice the proxy is gone" noticed_outage
# The killed proxy left its socket file behind; the restarted one must replace it.
docker start "$proxy" >/dev/null
docker update --restart unless-stopped "$proxy" >/dev/null
expect_status e2e-2 ROLLED_BACK
[[ $(proxy_call GET /_ping) == 200 ]] || fail "the restarted proxy does not answer"
[[ $(inspect_web '{{.Id}}') == "$serving_id" ]] || fail "a different container serves after the rollback"
[[ $(inspect_web '{{index .Config.Labels "org.opencontainers.image.version"}} {{.State.Running}}') == "1.1.0 true" ]] || fail "1.1.0 is not running after the rollback"
[[ $(inspect_web '{{.HostConfig.RestartPolicy.Name}}') == unless-stopped ]] || fail "the rollback did not restore the restart policy"
[[ $(in_data sha256sum /data/servio.db) == "$database_sha" ]] || fail "the database was not restored byte for byte"
[[ -z $(docker ps -aq --filter label=org.opencontainers.image.version=1.2.0) ]] || fail "the 1.2.0 container was left behind"
in_data test -f /data/ran-1.2.0 || fail "1.2.0 never ran, so the rollback proved nothing"
! in_data test -e /data/servio.db-journal || fail "the hot journal 1.2.0 left was not removed"
in_backups ls -a /backups | grep -q '^servio-1.1.0-.*\.db$' || fail "no backup of 1.1.0"
! in_backups ls -a /backups | grep -q '^\.journal' || fail "a journal was left behind"

echo "== update 1.1.0 -> 1.3.0 (broken), updater killed during HEALTH_CHECK"
request_update e2e-3 1.3.0
wait_for 120 "the updater to wait for 1.3.0's health check" updater_logged "HEALTH_CHECK: Waiting for servio-web ($REPO:1.3.0)"
docker kill servio-updater >/dev/null
# Not `docker compose up`: compose may recreate the self-updated container from its own (older) image.
docker start servio-updater >/dev/null 2>&1 || true
expect_status e2e-3 ROLLED_BACK
in_data cat /data/state/updater/status.json | jq -e '.message | contains("Recovered after an updater restart")' >/dev/null ||
  fail "the rollback did not come from start-up recovery"
[[ $(inspect_web '{{.Id}}') == "$serving_id" ]] || fail "a different container serves after the recovery"
[[ $(inspect_web '{{index .Config.Labels "org.opencontainers.image.version"}} {{.State.Running}}') == "1.1.0 true" ]] || fail "1.1.0 is not running after the recovery"
[[ $(in_data sha256sum /data/servio.db) == "$database_sha" ]] || fail "the recovery did not restore the database byte for byte"
[[ -z $(docker ps -aq --filter label=org.opencontainers.image.version=1.3.0) ]] || fail "the 1.3.0 container was left behind"
in_data test -f /data/ran-1.3.0 || fail "1.3.0 never ran, so the recovery proved nothing"
! in_data test -e /data/servio.db-journal || fail "the hot journal 1.3.0 left was not removed"

echo "== update 1.1.0 -> 1.4.0: tag reference and cleanup of superseded images"
# Containers of other images keep them in use; removing a tag of an image with several tags would untag it.
docker create --name e2e-holder-1.2.0 "$REPO:1.2.0" >/dev/null
docker tag "$REPO:1.3.0" "$REPO:e2e-extra"
docker create --name e2e-holder-1.3.0 "$REPO:1.3.0" >/dev/null
build_updater_release 0.0.3
self_updated=$(updater_id)
request_update e2e-4 1.4.0
expect_status e2e-4 SUCCEEDED
wait_for 60 "the image cleanup note" status_mentions "Removed superseded images"
# Checked here, not after 1.1.0: the container that logged 1.1.0's check has since replaced itself.
updater_logged "space check: probe_dir=/backups free_bytes=" || fail "the updater log has no space check line with byte counts"
in_data cat /data/state/updater/status.json |
  jq -e '[.log[] | select(.state == "SUCCEEDED")] | length >= 2 and (.[0].message | contains("superseded") | not)' >/dev/null ||
  fail "SUCCEEDED was not reported before the image cleanup note"
[[ $(inspect_web '{{.Config.Image}}') == "$REPO:1.4.0" ]] || fail "the new container does not reference its image by tag: $(inspect_web '{{.Config.Image}}')"
[[ $(inspect_web '{{.Image}}') == $(docker image inspect --format '{{.Id}}' "$REPO:1.4.0") ]] || fail "the new container does not run the pulled 1.4.0 image"
docker image inspect "$REPO:1.1.0" >/dev/null 2>&1 || fail "the replaced 1.1.0 image (rollback target) was removed"
! docker image inspect "$REPO:1.0.0" >/dev/null 2>&1 || fail "the superseded 1.0.0 image was not removed"
docker image inspect "$REPO:1.2.0" >/dev/null 2>&1 || fail "the 1.2.0 image a container uses lost its tag"
status_mentions "Kept superseded images a container still uses: $REPO:1.2.0" >/dev/null ||
  fail "the status does not report the image kept for its container"
for tag in 1.3.0 e2e-extra; do
  docker image inspect "$REPO:$tag" >/dev/null 2>&1 || fail "the image with two tags lost $REPO:$tag"
done
# The updater's own repository: the running release (1.1.0) and the newest older one (1.0.0) stay, 0.0.3 goes.
status_mentions "Removed superseded images: $REPO-updater:0.0.3." >/dev/null || fail "the status does not report the removed updater image"
updater_image_gone 0.0.3 || fail "the superseded updater image 0.0.3 was not removed"
updater_image_exists 1.0.0 || fail "the newest older updater image (rollback target) was removed"
updater_image_exists 1.1.0 || fail "the running updater image lost its tag"

echo "== updater self-update 1.1.0 -> 1.4.0 (broken updater): rollback"
wait_for 150 "the self-update to 1.4.0 to roll back" status_mentions "Updater self-update to 1.4.0 failed"
status_mentions "did not report a heartbeat within 30s" >/dev/null || fail "the rollback does not name the missing heartbeat"
[[ $(updater_id) == "$self_updated" ]] || fail "a different updater container runs after the rollback"
updater_runs 1.1.0 || fail "the 1.1.0 updater does not run after the rollback"
[[ $(inspect_updater '{{.HostConfig.RestartPolicy.Name}}') == unless-stopped ]] || fail "the rollback did not restore the updater's restart policy"
[[ -z $(docker ps -aq --filter "ancestor=$REPO-updater:1.4.0") ]] || fail "the broken 1.4.0 updater container was left behind"
no_container servio-updater-pre-1.1.0 || fail "the renamed updater container was left behind"
wait_for 60 "the heartbeat of the rolled-back updater" \
  heartbeat_matches '.updaterVersion == "1.1.0" and .selfUpdate.state == "ROLLED_BACK" and .selfUpdate.targetVersion == "1.4.0"'
! in_backups test -e /backups/.self-update.json || fail "the handover record was left behind"
docker rm e2e-holder-1.2.0 e2e-holder-1.3.0 >/dev/null
heartbeat_idle() { in_data cat /data/state/updater/heartbeat.json | jq -e '.activeRequestId == null'; }
wait_for 45 "the heartbeat to report no active request" heartbeat_idle

echo "== updater container health (liveness stamp on /backups)"
wait_for 90 "the updater to be healthy" updater_is_healthy

echo "updater e2e: all checks passed"
