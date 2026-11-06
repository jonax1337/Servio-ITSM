# Servio updater sidecar

A small Node service (no dependencies, no build step) that performs the actual
Servio update when an admin schedules one in **Settings → Updates**. The app
container never gets the Docker socket; the updater reaches Docker through a
socket proxy and runs without privileges.

```
app ──writes──▶ <state>/updater/request.json ──▶ updater ──tcp──▶ docker-proxy ──▶ docker.sock
app ◀──reads─── <state>/updater/status.json   ◀──┘
app ◀──reads─── <state>/updater/heartbeat.json ◀─ every 15 s
                                      updater ──▶ /backups (own volume): database backups + journal
```

## Threat model

The app is internet-facing. Assume an attacker controls everything the app's
user (`node`, uid 1000) can write on the shared `/data` volume: the database,
`/data/state/**`, symlinks, huge files, forged requests. The goal is that the
worst they can do **through the updater** is to trigger an update to a newer,
legitimate release of `SERVIO_IMAGE`. That is why:

| Measure | Where |
| --- | --- |
| The updater runs as `node` (uid 1000), `read_only`, `cap_drop: ALL`, `no-new-privileges`. It has no more file privileges than the attacker, so file tricks gain nothing. No chown, no root. | `updater/Dockerfile`, compose |
| Docker access goes through `tecnativa/docker-socket-proxy`, which allows only containers, images, networks, start/stop and writes. No exec, volumes, build or swarm. The socket is mounted only into the proxy. | compose |
| Backups and the crash journal live on their own volume (`servio-backups` at `/backups`) that the app never mounts. | compose |
| Every file under `/data` is `lstat`-checked: the database, `-wal`, `-shm` and `request.json` must be regular files, the state directories must be real directories. Sources are opened with `O_NOFOLLOW`. Backups are created with `wx` (never overwrite), restores go through an exclusive temp file and a rename. | `safe-fs.mjs`, `backup.mjs` |
| `request.json` is read with a 64 KB cap, `status.json` with 1 MB. Temp files carry a random UUID and are created exclusively. | `state-files.mjs` |
| The image repository comes only from `SERVIO_IMAGE`; the request supplies a strict `X.Y.Z[-pre]` version, no older than `REQUEST_MAX_AGE_SECONDS` (default 1 h) and at most 5 min in the future. | `config.mjs`, `update-flow.mjs` |
| Only newer versions are installed (`ALLOW_DOWNGRADE=true` overrides). | `versions.mjs` |
| The updater only touches the one container labelled `servio.updater.managed=true` and its `-pre-<version>` twin; it exposes no ports. | `managed-container.mjs` |

Docker access is still powerful: creating containers can mean root on the host.
The proxy limits *which calls* the updater can make, not *what the container
bodies contain*. Use the stack only on hosts where that is acceptable.

**Socket vs. proxy.** `DOCKER_HOST=tcp://host:port` (a proxy, recommended) keeps
the socket out of the updater process and lets the updater run unprivileged.
`DOCKER_SOCKET=/var/run/docker.sock` mounts the socket into the updater directly:
simpler, but the updater would need access to the socket's group (usually root)
and a compromised updater gets the full, unfiltered Docker API. `DOCKER_HOST` wins
if both are set.

## Setup

Use [`docker-compose.release.yml`](../docker-compose.release.yml). It runs `web`
(the published image, label `servio.updater.managed=true`), `gotenberg`,
`docker-proxy` and `updater` (image `ghcr.io/<owner>/servio-updater`, tagged with
the same versions as the app). `web` and `updater` run as the same uid (`node`,
1000) and share `servio-data` at `/data`; the updater alone has `servio-backups`
at `/backups`. The `docker-api` network is `internal` and joins only the proxy
and the updater.

Requirements for the managed container:

- the label `servio.updater.managed=true` (the updater refuses any container without it),
- a HEALTHCHECK (the published image has one; the updater waits for `healthy`),
- SQLite on the shared volume: `DATABASE_URL=file:<DB_FILE>`, an **absolute** path equal to the
  updater's `DB_FILE` (relative `file:./…` URLs are refused).

Compose caveat: the updater replaces `web` outside compose's knowledge. A later
manual `docker compose up` recreates `web` from `SERVIO_VERSION`, so keep it in
`.env` in sync with what the UI installed, or use `latest` (which follows only
stable releases; prerelease tags never move `latest`).

## Configuration (environment of the updater container)

| Variable | Default | Meaning |
| --- | --- | --- |
| `SERVIO_IMAGE` | **required** | Image repository without tag, e.g. `ghcr.io/jonax1337/servio`. |
| `SERVIO_CONTAINER` | – | Name of the managed container. Without it the updater looks for the single container labelled `servio.updater.managed=true`. |
| `SERVIO_STATE_DIR` | `/data/state` | Shared state directory (contract below). |
| `DB_FILE` | `/data/servio.db` | SQLite file to back up and restore. |
| `BACKUP_DIR` | `/backups` | Backups (`servio-<fromVersion>-<UTC timestamp>.db`) and `.journal.json`. Must not be reachable by the app. |
| `BACKUP_KEEP` | `5` | Newest backups kept; pruned only after a successful update, never the backup of the running update. |
| `HEALTH_TIMEOUT_SECONDS` | `300` | How long the new (and, on rollback, the old) container may take to become healthy. `unhealthy` fails immediately. |
| `PULL_TIMEOUT_SECONDS` | `1800` | Overall deadline for pulling the image. |
| `REQUEST_MAX_AGE_SECONDS` | `3600` | Older requests are rejected. |
| `ALLOW_DOWNGRADE` | `false` | Allow installing a version that is not newer than the installed one. Databases are not migrated back. |
| `ALLOW_UPDATE_WITHOUT_BACKUP` | `false` | Required to update when `DATABASE_URL` is not a `file:` URL (Postgres). |
| `REGISTRY_AUTH` | – | Base64url-encoded Docker auth config, sent as `X-Registry-Auth` when pulling. |
| `DOCKER_HOST` | – | `tcp://host:port` of a docker-socket-proxy (port defaults to 2375). Wins over `DOCKER_SOCKET`. |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Socket (or Windows named pipe) of the Docker daemon. |
| `DOCKER_API_VERSION` | `v1.44` | Engine API prefix. `v1.44` is accepted by Engine 25+ (Engine 29.0–29.2 refuse older); use `v1.43` for Engine 24. |

## State files (contract with the app)

All JSON, written atomically; readers treat a missing or half-written file as absent.
Directory: `$SERVIO_STATE_DIR/updater/`.

| File | Writer | Shape |
| --- | --- | --- |
| `request.json` | app | `{ "id", "targetVersion", "requestedAt", "requestedBy" }` (≤ 64 KB) |
| `status.json` | updater | `{ "id", "state", "fromVersion", "targetVersion", "message", "updatedAt", "log": [{ "at", "state", "message" }] }` |
| `heartbeat.json` | updater, every 15 s | `{ "updaterVersion", "at", "dockerOk", "container", "image" }` |

`state` is one of `PENDING | PULLING | BACKING_UP | SWITCHING | HEALTH_CHECK | SUCCEEDED | FAILED | ROLLED_BACK`.
The updater writes `PENDING` only when it has something to say before the pull (e.g. unknown installed version).

- A request is processed when its `id` differs from the `id` in `status.json`. A handled request is never repeated.
- If `request.json` or `status.json` is not a regular file, or too large, the updater logs it once and does nothing (fail closed).
- `FAILED` means nothing was changed, except the explicit `ROLLBACK FAILED — manual action required: …` message.
- The app treats the updater as connected while `heartbeat.at` is younger than 60 s and `dockerOk` is `true`.

## What an update does

1. **Validate** the request (version format, age), locate the managed container, refuse a
   downgrade (unless `ALLOW_DOWNGRADE=true`; an installed version that cannot be determined
   proceeds with a note), check that `DATABASE_URL` equals `file:<DB_FILE>` and that the
   database and its WAL/SHM are regular files, and make sure no `<name>-pre-<version>`
   container is left over.
2. **PULLING** `SERVIO_IMAGE:targetVersion` under `PULL_TIMEOUT_SECONDS`. The pulled image is
   inspected; its id and digest are logged and the new container is created **from the image id**,
   so a tag that moves later cannot change what runs.
3. Re-read `request.json`. If it was removed or replaced during the pull, abort: nothing changed.
4. **BACKING_UP**: write the journal, stop the container (30 s grace), copy `DB_FILE` and
   `-wal`/`-shm` to `BACKUP_DIR`. If stop or backup fails, the old container is started again.
5. **SWITCHING**: rename the old container to `<name>-pre-<fromVersion>`, create the new one
   under the original name from the old container's configuration, connect additional networks, start it.
6. **HEALTH_CHECK**: poll until Docker reports `healthy`. An exit, a restart or `unhealthy` fails the check;
   a container without HEALTHCHECK counts as healthy after 15 s running.
7. **SUCCEEDED**: remove the old container, then prune old backups.
8. **Rollback** on any failure in 5–6: remove the new container, restore the database files
   (removing `-wal`/`-shm` that did not exist at backup time), rename the old container back, start it
   and wait until healthy → `ROLLED_BACK`.

### Crash recovery

Before the old container is stopped the updater writes `BACKUP_DIR/.journal.json` (old container id,
names, new container id, backup path, step) and updates it at every step. If the updater dies mid-update,
the next start finishes or reverts the work:

- step `STOPPING`/`BACKED_UP` (nothing switched): start the old container → `FAILED` ("nothing was changed").
- step `SWITCHING`/`STARTED`: remove the new container (also one that took the managed name but was never
  recorded), restore the database, rename the old container back, start it → `ROLLED_BACK`.
- step `SWITCHED` (new container was healthy): remove the old container → `SUCCEEDED`.

The database is never restored underneath an old container that is already running. A recovery that fails
keeps the journal and reports `ROLLBACK FAILED`; it is retried on the next start. Without a journal, a
non-terminal status is closed as `FAILED` with a hint to run `docker ps -a`.

### Leftover `-pre-` container

The old container stays as `<name>-pre-<fromVersion>` until the new one is healthy and is then removed.
If it is still there at the next update (the removal failed, or a rollback failed), the next update
**refuses to start** rather than replace it: it may be the only copy of the previous version. Remove it
with `docker rm <name>-pre-<version>` once you have confirmed that the running container is the one you want.

### How the new container is configured

Like Watchtower, only **user-supplied** settings are carried over: environment entries, labels, `Cmd`,
`Entrypoint`, `Healthcheck`, `User`, `WorkingDir`, `StopSignal`, `StopTimeout` and `Shell` are compared with the
old image's defaults, so the new image's defaults win. `HostConfig` (binds, mounts, ports, restart policy, …) is
copied; anonymous volumes are re-bound by name so their data survives. Networks keep their aliases (without the
old container's short id), static IPs and driver options. Compose labels are kept, so `docker compose ps` still
lists the container; the `config-hash` label is stale afterwards.

## What rollback does and does not cover

Covered: the container swap and the SQLite database (restored byte for byte from the backup taken while the
container was stopped). Not covered: uploads under `/data/uploads`, Postgres data (no backup is taken),
anything the new version did outside the container (outgoing mail, webhooks). A new version that is healthy but
wrong needs a manual restore from `/backups`.

## Development

```bash
node node_modules/vitest/vitest.mjs run tests/unit/updater
```

Tests use an in-memory fake Docker (`tests/unit/updater-test-kit.ts`) and temp directories; a fake clock makes
health timeouts instantaneous and a kill helper simulates the updater dying at a chosen Docker call. The Docker
client is tested against a real HTTP server on a temp unix socket (a named pipe on Windows) and on TCP. Tests that
need file symlinks are skipped where the OS refuses to create them (Windows without the symlink privilege);
directory junctions and "directory instead of file" cases run everywhere.
