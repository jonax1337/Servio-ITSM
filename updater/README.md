# Servio updater sidecar

A small Node service (no dependencies, no build step) that performs the actual
Servio update when an admin schedules one in **Settings → Updates**. The app
container never gets the Docker socket; the updater reaches Docker through a
filtering socket proxy and runs without privileges or network.

```
app ──writes──▶ <state>/updater/request.json ──▶ updater ──unix socket──▶ docker-proxy ──▶ docker.sock
app ◀──reads─── <state>/updater/status.json   ◀──┘      (docker-api volume, 0660, uid/gid 64999)
app ◀──reads─── <state>/updater/heartbeat.json ◀─ every 15 s
                                      updater ──▶ /backups (own volume): backups, journal, ledger, liveness
```

## Threat model

The app is internet-facing. Assume an attacker controls everything the app's
user (`node`, uid 1000) can write on the shared `/data` volume: the database,
`/data/state/**`, symlinks, FIFOs, huge files, forged requests. The goal is that
the worst they can do **through the updater** is to trigger an update to a
strictly newer, stable, legitimate release of `SERVIO_IMAGE`; and that no crash
of the updater or intervention of an operator leaves the system without a
running app, with a migrated database under an older version, or without a
container the operator put in place. That is why:

| Measure | Where |
| --- | --- |
| The updater runs as `node` (uid 1000), `read_only`, `cap_drop: ALL`, `no-new-privileges`, `network_mode: none`. It has no more file privileges on `/data` than the attacker; no chown, no root. | `updater/Dockerfile`, compose |
| Docker access goes through [`wollomatic/socket-proxy`](https://github.com/wollomatic/socket-proxy) (pinned by digest). It serves a filtered unix socket on the `docker-api` volume (tmpfs owned by uid/gid 64999, which nothing else uses, mode 0750; the socket 0660). Only the proxy and the updater mount it and are in that group (the updater keeps uid 1000 for `/data`); neither has a network, so neither the host network, another container, nor a host user who happens to have uid 1000 can reach it. The proxy enforces a path allowlist (the method + path pairs the updater uses, anchored; see the compose file and the table below) and refuses host `Binds`/bind mounts in create requests. Container calls are scoped: by name only `servio-web` and `servio-web-pre-<version>`, otherwise a full 64-hex id; short-id prefixes and the container list are refused, so the updater cannot discover other containers on the host. This requires `SERVIO_CONTAINER` (the label-only lookup needs the list); renaming the `web` container means changing it and the proxy rules together. Image calls are scoped to the two managed repositories (`SERVIO_IMAGE_PATTERN`, the updater's own `-updater` repository): inspect by tag, digest or full image id, removal only by `repo:tag` / `repo@sha256:…`. Request bodies and query strings are not inspected otherwise. | compose |
| Backups, the crash journal, the ledger of handled requests and the liveness stamp live on their own volume (`servio-backups` at `/backups`) that the app never mounts. | compose |
| Every file under `/data` is `lstat`-checked, opened with `O_NOFOLLOW` and `O_NONBLOCK`, then `fstat`-checked: the database and its sidecars (`-wal`, `-shm`, `-journal`) and `request.json` must be regular files, the state directories real directories. A FIFO cannot block a read. | `safe-fs.mjs`, `backup.mjs` |
| State files are written through a directory descriptor (Linux `/proc/self/fd`), so swapping `/data/state/updater` for a symlink mid-write cannot redirect the write. Temp files carry a random UUID, are created exclusively and fsynced, then renamed, and the directory is fsynced. | `safe-fs.mjs`, `state-files.mjs` |
| Backups are copied to a temp name, fsynced and hard-linked to their final name (never overwriting); restores go through an exclusive temp file and a rename. | `backup.mjs` |
| `request.json` is read with a 64 KB cap, `status.json` with 1 MB; a malformed or unreadable `status.json` is ignored. | `state-files.mjs`, `update-flow.mjs` |
| The image repository comes only from `SERVIO_IMAGE`; the request supplies a strict `X.Y.Z` version (prereleases only with `ALLOW_PRERELEASE=true`), no older than `REQUEST_MAX_AGE_SECONDS` (default 1 h) and at most 5 min in the future. The pulled image must carry `org.opencontainers.image.version` equal to the requested version. | `config.mjs`, `update-flow.mjs` |
| Only strictly newer versions are installed, and an installed version that cannot be determined is refused (`ALLOW_DOWNGRADE=true` overrides both). | `versions.mjs`, `update-flow.mjs` |
| Handled request ids are recorded on `/backups` before an update starts, so a forged or lost `status.json` cannot make the updater run a request twice. After an update that took the app down and did not succeed, the same target is refused for `RETRY_COOLDOWN_SECONDS` (default 1 h). | `ledger.mjs` |
| The updater only touches the one container labelled `servio.updater.managed=true`, its `-pre-<version>` twin and the replacement it created (labelled `servio.updater.request=<request id>`); it exposes no ports. | `managed-container.mjs`, `update-flow.mjs` |

The proxy's allowlist is exactly what the updater calls (`$V` is the API version prefix, `<img>` the managed
repositories `SERVIO_IMAGE_PATTERN(-updater)?`, `<ref>` a tag `:<tag>` or a digest `@sha256:<64 hex>`):

| Method | Path | Used for |
| --- | --- | --- |
| `GET` | `/_ping` | liveness of Docker |
| `GET` | `$V/containers/{servio-web, servio-web-pre-*, <64 hex>}/json` | inspect the managed container, its twin, the replacement |
| `POST` | `$V/containers/create` | create the replacement |
| `POST` | `$V/containers/{servio-web, servio-web-pre-*, <64 hex>}/{start,stop,rename,update}` | switch, rollback, restart policy |
| `DELETE` | `$V/containers/{servio-web, servio-web-pre-*, <64 hex>}` | remove the old container or a failed replacement |
| `POST` | `$V/networks/<name>/connect` | re-attach additional networks |
| `POST` | `$V/images/create` | pull |
| `GET` | `$V/images/{<img><ref>, sha256:<64 hex>}/json` | inspect the target and the running image |
| `GET` | `$V/images/json` | list images of a managed repository (cleanup) |
| `DELETE` | `$V/images/<img><ref>` | remove a superseded image reference (cleanup; never forced, never by id) |

Exec, attach, logs, archive, volumes, build, system/info, swarm, plugins, image tag/push/import by path and
everything else is refused (403/405).

Residual risk. Docker access is still powerful. The proxy filters methods,
paths and host bind mounts, but it does not inspect the rest of a request
body or any query string, so these still pass: a create request for a
privileged container (devices, host namespaces, capabilities), an image import
through `images/create?fromSrc=…`, a pull of **any** image through
`images/create?fromImage=<any repository>` (the repository is a query parameter,
so the managed-repository scoping of the image rules does not apply to pulls),
a container name chosen freely in the query of create or rename, the full image
list of the host (`images/json` with any filter), query flags such as
`?force=true` on the allowed calls (the path rules cannot see them: a forced image
removal of a managed reference, or a forced stop), and calls naming another
container by its full 64-hex id (the updater has no way to learn one: the
container list, short ids and foreign names are refused). Image removal is
limited by path to references of the managed repositories; the updater itself
never forces it, so Docker refuses to delete an image a container uses. Whoever gains code execution
**in the updater process** (not just write access to `/data`) therefore controls the
host. The updater only ever sends create bodies derived from the managed container's
own inspected configuration, which the app cannot change, and pulls with `fromImage`
only. Use the stack only on hosts where this is acceptable.

Two weaker spots remain on the attacker-writable volume, by design of the
contract: `status.json` and `heartbeat.json` are output the app trusts, so an
attacker can show admins a false status (but cannot make the updater act on
it), and `request.json` is read through its parent directories by path, so a
swapped `/data/state/updater` can at most make the updater ignore a request.

**Socket vs. proxy.** `DOCKER_SOCKET` pointing at the proxy's filtered socket
is the supported setup. `DOCKER_SOCKET=/var/run/docker.sock` would mount the
real socket into the updater: simpler, but the updater would need the socket's
group and a compromised updater gets the unfiltered Docker API.
`DOCKER_HOST=tcp://host:port` is still accepted for other proxies, but a TCP
proxy is unauthenticated for everything that can reach it; avoid it.
`DOCKER_HOST` wins if both are set.

## Setup

Use [`docker-compose.release.yml`](../docker-compose.release.yml). It runs `web`
(the published image, label `servio.updater.managed=true`), `gotenberg`,
`docker-proxy` and `updater` (image `ghcr.io/<owner>/servio-updater`, tagged with
the same versions as the app). `web` and `updater` run as the same uid (`node`,
1000) and share `servio-data` at `/data`; the updater alone has `servio-backups`
at `/backups`. The `docker-api` volume holds only the proxy's filtered socket
and is mounted by the proxy and the updater only.

Set `DOCKER_GID` in `.env` to the group id of the Docker socket
(`stat -c %g /var/run/docker.sock`); the proxy runs as uid/gid 64999 with that extra group.
On SELinux hosts the proxy may additionally need `security_opt: [label=disable]`
to reach the socket.

Requirements for the managed container:

- the label `servio.updater.managed=true` (the updater refuses any container without it),
- a HEALTHCHECK (the published image has one; the updater waits for `healthy`),
- SQLite on the shared volume: `DATABASE_URL=file:<DB_FILE>`, an **absolute** path equal to the
  updater's `DB_FILE` (relative `file:./…` URLs are refused),
- named volumes only: the proxy refuses host bind mounts in the new container's create request,
  so the updater refuses a container with host bind mounts before it changes anything. To allow some,
  list the host directories both in the proxy's `-allowbindmountfrom` and in the updater's `ALLOW_BIND_MOUNTS_FROM`.

Compose caveat: the updater replaces `web` outside compose's knowledge. The new
container references its image by tag (`SERVIO_IMAGE:<version>`), so `docker ps`
shows the release that runs. A later manual `docker compose up` recreates `web`
from `SERVIO_VERSION`, so keep it in `.env` in sync with what the UI installed, or
use `latest` (which follows only stable releases; prerelease tags never move
`latest`). A compose file that hard-codes an older tag in `image:` downgrades the
app on the next `docker compose up`, and the older image then refuses to start on
the migrated database; always drive the tag from `SERVIO_VERSION`.

## Configuration (environment of the updater container)

| Variable | Default | Meaning |
| --- | --- | --- |
| `SERVIO_IMAGE` | **required** | Image repository without tag, e.g. `ghcr.io/jonax1337/servio`. |
| `SERVIO_CONTAINER` | – | Name of the managed container. Without it the updater looks for the single container labelled `servio.updater.managed=true`. |
| `SERVIO_STATE_DIR` | `/data/state` | Shared state directory (contract below). |
| `DB_FILE` | `/data/servio.db` | SQLite file to back up and restore. |
| `BACKUP_DIR` | `/backups` | Backups (`servio-<fromVersion>-<UTC timestamp>.db`) and `.journal.json`. Must not be reachable by the app. |
| `BACKUP_KEEP` | `5` | Newest backups kept; pruned whenever an update ends, never the backup of that update. |
| `HEALTH_TIMEOUT_SECONDS` | `300` | How long the new (and, on rollback, the old) container may take to become healthy. `unhealthy` fails immediately. |
| `PULL_TIMEOUT_SECONDS` | `1800` | Overall deadline for pulling the image. |
| `REQUEST_MAX_AGE_SECONDS` | `3600` | Older requests are rejected. |
| `ALLOW_DOWNGRADE` | `false` | Allow installing a version that is not newer than the installed one, or over an installed version that cannot be determined. Databases are not migrated back. |
| `ALLOW_PRERELEASE` | `false` | Allow installing prerelease versions (`1.2.3-rc.1`). |
| `ALLOW_BIND_MOUNTS_FROM` | – | Comma-separated absolute host directories the managed container may bind-mount. Must match the proxy's `-allowbindmountfrom`. |
| `RETRY_COOLDOWN_SECONDS` | `3600` | After an update that stopped the app and did not succeed, the same target version is refused for this long. |
| `ALLOW_UPDATE_WITHOUT_BACKUP` | `false` | Required to update when `DATABASE_URL` is not a `file:` URL (Postgres). |
| `REGISTRY_AUTH` | – | Base64url-encoded Docker auth config, sent as `X-Registry-Auth` when pulling. |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Unix socket (or Windows named pipe) to reach Docker; the compose file sets the proxy's `/run/docker-api/docker.sock`. |
| `DOCKER_HOST` | – | `tcp://host:port` of a TCP proxy (port defaults to 2375). Wins over `DOCKER_SOCKET`. Not recommended (unauthenticated). |
| `DOCKER_API_VERSION` | `v1.44` | Engine API prefix. `v1.44` is accepted by Engine 25+ (Engine 29.0–29.2 refuse older); use `v1.43` for Engine 24. |
| `UPDATER_IMAGE` | `<SERVIO_IMAGE>-updater` | Repository of the updater's own image; its superseded versions are cleaned up too. The proxy rules allow `<SERVIO_IMAGE_PATTERN>-updater` only. |
| `UPDATER_KEEP_IMAGES` | `1` | Superseded releases kept per repository after a successful update (at least 1). The image the replaced container ran (recorded by id in the journal) is always kept and counts as the first, as the rollback target. |
| `PRUNE_IMAGES` | `true` | `false` turns the cleanup of superseded images off (after updates and before a pull that lacks space). |
| `PULL_SPACE_CHECK` | `true` | `false` turns the free-space check before a pull off. |
| `PULL_SPACE_MARGIN_MB` | `1024` | Head room required on Docker's data root on top of the image's download and unpacked size. |
| `PULL_SPACE_PROBE_DIR` | `BACKUP_DIR` | A directory on the filesystem that holds the image store, measured for the free-space check. The default `/backups` is a named volume, stored under Docker's data root (`/var/lib/docker`); mount another one if your volumes live elsewhere. With the **containerd image store** (the default for new installations of Docker Engine 29, `docker info` shows `driver-type: io.containerd.snapshotter.v1`), image content and layers live under containerd's root (`/var/lib/containerd`), not under the data root: if that is a different filesystem, mount a directory of it into the updater and point `PULL_SPACE_PROBE_DIR` there, or set `PULL_SPACE_CHECK=false`. |

## State files (contract with the app)

All JSON, written atomically; readers treat a missing or half-written file as absent.
Directory: `$SERVIO_STATE_DIR/updater/`.

| File | Writer | Shape |
| --- | --- | --- |
| `request.json` | app | `{ "id", "targetVersion", "requestedAt", "requestedBy", "downloadBytes"?, "imageBytes"? }` (≤ 64 KB); from the registry manifest, only used for the free-space check (each ignored unless a positive integer up to 256 GiB): `downloadBytes` is the compressed size of the target's layers the running release does not share, `imageBytes` that of the whole target. The app deletes the file when it fails a running window without the updater's result |
| `status.json` | updater | `{ "id", "state", "fromVersion", "targetVersion", "message", "updatedAt", "log": [{ "at", "state", "message" }] }` |
| `heartbeat.json` | updater, every 15 s | `{ "updaterVersion", "at", "dockerOk", "container", "image", "activeRequestId" }`; `activeRequestId` is the request being worked on (also a rollback waiting for Docker), `null` when idle |

`state` is one of `PENDING | PULLING | BACKING_UP | SWITCHING | HEALTH_CHECK | SUCCEEDED | FAILED | ROLLED_BACK`
(`PENDING` is part of the contract but not currently written).

- A request is processed once: its id is recorded in `BACKUP_DIR/.ledger.json` before the update starts.
  A request whose id equals the `id` in `status.json` is skipped too.
- If `request.json` is not a regular file, is too large or cannot be read, the updater logs it once and does nothing.
  An unreadable or malformed `status.json` is ignored (it is output only).
- `FAILED` means nothing was changed, except the explicit `ROLLBACK FAILED — manual action required: …` and
  `MANUAL ACTION REQUIRED — …` messages.
- The app treats the updater as connected while `heartbeat.at` is younger than 60 s and `dockerOk` is `true`.
  The container HEALTHCHECK does not use `heartbeat.json` (the app can forge it) but `BACKUP_DIR/.liveness.json`.
- A status write that fails (e.g. a full disk) is retried on every poll until a later status lands or a new
  request starts. The app fails a running window once nothing moved for `UPDATER_STALE_MINUTES` (default 10) and
  either the heartbeat stopped too or `activeRequestId` is no longer that window's id; it then deletes
  `request.json` (if it is that window's), so an updater that comes back late gives up before it stops the app
  (step 3 below) instead of updating behind a window that reads `FAILED`.

## What an update does

1. **Validate** the request (version format, no prerelease unless allowed, age), refuse while an earlier
   update's journal is set aside or the target is cooling down, locate the managed container, refuse a
   downgrade or an unknown installed version (unless `ALLOW_DOWNGRADE=true`), check that `DATABASE_URL`
   equals `file:<DB_FILE>` and that the database and its sidecars are regular files, and make sure no
   `<name>-pre-<version>` container is left over. Unless the target image is already on the host, check the
   free space on Docker's data root (`PULL_SPACE_PROBE_DIR`): the download (`downloadBytes`, the layers the
   running release lacks, else the installed image's size), the unpacked size (the installed image's size
   scaled to the new share `downloadBytes / imageBytes`, else the installed image's size) and
   `PULL_SPACE_MARGIN_MB`. When
   it is short, superseded images are removed first (keeping the installed release and the newest
   `UPDATER_KEEP_IMAGES` older ones); if it is still short → `FAILED` ("Not enough free space for the image
   pull"), nothing changed.
2. **PULLING** `SERVIO_IMAGE:targetVersion` under `PULL_TIMEOUT_SECONDS`. The pulled image must be labelled
   with the requested version; its id and digest are logged. The new container is created **by tag**
   (`SERVIO_IMAGE:targetVersion`, so operators and tooling see the release) and must resolve to the pulled
   image's id; a tag that moved in between fails the switch and rolls it back.
3. Re-read `request.json` (abort if it was removed or replaced during the pull), check that `/backups` and
   the database directory have room for a backup and a restore (database size plus 10 %, at least 64 MB), and
   inspect the container again: if it was recreated or removed during the pull, abort, nothing changed. Host
   bind mounts outside `ALLOW_BIND_MOUNTS_FROM` are refused already in step 1.
4. **BACKING_UP**: write the journal, set the container's restart policy to `no` (so a Docker restart cannot
   bring the old version up next to the new one), stop it (30 s grace), copy `DB_FILE` and its
   `-wal`/`-shm`/`-journal` to `BACKUP_DIR`. If stop or backup fails, the policy is restored and the old
   container started again (unless it vanished: then nothing was changed).
5. **SWITCHING**: rename the old container to `<name>-pre-<fromVersion>`, create the new one under the original
   name from the old container's configuration (with its original restart policy and the label
   `servio.updater.request=<request id>`), connect additional networks, start it.
6. **HEALTH_CHECK**: poll until Docker reports `healthy`, then poll twice more (one health interval apart): the
   new container must still hold the name, run, not be restarting, still be `healthy`, and be the same instance
   (unchanged `StartedAt` and `RestartCount`). The new container inherits the restart policy, so a crash right
   after the first `healthy` shows up as a restart, not as a stopped container; either fails the check. So do an
   exit and `unhealthy`; a container without HEALTHCHECK counts as healthy after 15 s running.
7. **SUCCEEDED**: remove the old container and report `SUCCEEDED`. Then remove the superseded images of
   `SERVIO_IMAGE` and `UPDATER_IMAGE`: every release older than the one now running except the newest
   `UPDATER_KEEP_IMAGES` (default 1), the image the old container ran (by id, whatever its labels say) always
   being the first kept one (the rollback target). Images newer than the running release, images without a
   readable version, images that also carry a reference of another repository, images with several tags, and
   images a container uses stay. Removal goes tag first and is never forced: Docker checks for containers only
   when the last tag of an image is removed (it answers 409 and nothing is untagged), while removing one of
   several tags would just untag the image under a running container, so such images are left alone (several
   tags only come from manual pulls). The result is added to the status as a note after `SUCCEEDED`; a failed
   cleanup never fails the update. `PRUNE_IMAGES=false` skips it.
8. **Rollback** on any failure in 5–6: remove the new container, restore the database files (removing sidecars
   that did not exist at backup time, e.g. the hot `-journal` of a migration that was killed), rename the old
   container back, restore its restart policy, start it and wait until healthy → `ROLLED_BACK`.

However it ends, old backups are pruned (never this update's) along with copies left by an interrupted backup.
The final status is written before the journal is removed, so a crash in between only replays a harmless recovery;
a manual-action outcome sets the journal aside first, then reports.

Docker calls that are safe to repeat (inspect, start, stop, update, remove, ping, and the rollback's rename back)
are retried for up to 3 minutes when the connection to Docker or the proxy fails (refused, missing socket, reset,
idle) or the answer is 502/503/504. Any other answer, including a 500 (port already allocated, OCI runtime
error), is final. Pull, create, connect and the forward rename are not repeated. If Docker is still away after
those 3 minutes, a rollback (or the end of a recovered switch) is not reported as failed: the status keeps its
step with a note, the journal stays where it is (so updates stay blocked), and every poll retries it from the
journal until Docker answers.

### Crash recovery

Before the old container is stopped the updater writes `BACKUP_DIR/.journal.json` (request id, old container id,
names, the new image id, the new container id once known, the original restart policy, backup, step) and updates
it at every step, including `RESTORED` once a rollback has put the database back (or, without a backup, has
passed that point). If the updater dies
mid-update, its next start waits for Docker, then (before it reads anything under `/data/state`) finishes or
reverts the work:

- step `STOPPING`/`BACKED_UP` (nothing switched): restore the restart policy, start the old container →
  `FAILED` ("nothing was changed").
- step `SWITCHING`/`STARTED`: remove the new container (the recorded one, or one holding the managed name that
  carries this request's label and the new image), restore the database, rename the old container back, start
  it → `ROLLED_BACK`.
- step `RESTORED`: as above without restoring again (the old container may already have written new data).
- step `SWITCHED` (new container was healthy): remove the old container → `SUCCEEDED`, provided the new
  container is still the instance that passed the health check (same `StartedAt`/`RestartCount`, running, healthy).

Recovery acts only while Docker still matches the journal: the old container exists (and is stopped while a
restore is due), the managed name is held by nobody, the old container or this update's replacement, and after a
healthy switch the new container is running and the old one is not. Otherwise it changes nothing and reports
`MANUAL ACTION REQUIRED — the containers no longer match the update journal`. That and a failed rollback
(`ROLLBACK FAILED — manual action required`) set the journal aside as `BACKUP_DIR/.journal.manual-<time>.json`
(the message names the file, the database backup and, since the old container may still have restart policy
`no`, the `docker update --restart …` command that puts its policy back; if the journal cannot be moved, the
message says so and the updater keeps replaying it on every poll);
it is never replayed, and **further updates are refused until you delete it**. Once the containers are the way
you want them:

```bash
docker compose -f docker-compose.release.yml exec updater ls -a /backups
docker compose -f docker-compose.release.yml exec updater rm /backups/.journal.manual-<time>.json
```

Without a journal, a non-terminal status is closed as `FAILED` with a hint to run `docker ps -a`.

### Leftover `-pre-` container

The old container stays as `<name>-pre-<fromVersion>` until the new one is healthy and is then removed.
If it is still there at the next update (the removal failed, or a rollback failed), the next update
**refuses to start** rather than replace it: it may be the only copy of the previous version. Remove it
with `docker rm <name>-pre-<version>` once you have confirmed that the running container is the one you want.

### How the new container is configured

Like Watchtower, only **user-supplied** settings are carried over: environment entries, labels, `Cmd`,
`Entrypoint`, `Healthcheck`, `User`, `WorkingDir`, `StopSignal`, `StopTimeout` and `Shell` are compared with the
old image's defaults, so the new image's defaults win. `HostConfig` (binds, mounts, ports, restart policy, …) is
copied (the restart policy as it was before the update); anonymous volumes are re-bound by name so their data
survives. Networks keep their aliases (without the
old container's short id), static IPs and driver options. Compose labels are kept, so `docker compose ps` still
lists the container; the `config-hash` label is stale afterwards.

## What rollback does and does not cover

Covered: the container swap and the SQLite database (restored byte for byte from the backup taken while the
container was stopped). Not covered: uploads under `/data/uploads`, Postgres data (no backup is taken),
anything the new version did outside the container (outgoing mail, webhooks). A new version that is healthy but
wrong needs a manual restore from `/backups`.

Backups are copies of a file the app (and so an attacker in it) can write: treat them as untrusted data. Open
them only with SQLite tools on a machine where a malformed database file does no harm, and do not restore one
taken after a suspected compromise.

The app image refuses to boot on a database that holds migrations it does not ship (a newer release migrated it
and no restore happened), so an older version never runs on a newer schema. `ALLOW_UNKNOWN_MIGRATIONS=true`
on `web` overrides this (see `docker/entrypoint.sh`).

## Development

```bash
node node_modules/vitest/vitest.mjs run tests/unit/updater
```

Tests use an in-memory fake Docker (`tests/unit/updater-test-kit.ts`) and temp directories; a fake clock makes
health timeouts instantaneous and a kill helper simulates the updater dying at a chosen Docker call. The Docker
client is tested against a real HTTP server on a temp unix socket (a named pipe on Windows) and on TCP. Tests that
need file symlinks are skipped where the OS refuses to create them (Windows without the symlink privilege), and the
`/proc/self/fd` and FIFO tests run on Linux only; directory junctions and "directory instead of file" cases run
everywhere.

The CI job `updater-e2e` (`tests/updater-e2e/run.sh`) runs the real updater image behind the real proxy, configured
by `docker-compose.release.yml`, against a local registry: one update must succeed, and one to a release whose
health check fails must roll back with the database restored byte for byte and the previous container running.
