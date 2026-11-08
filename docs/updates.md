# Updates & maintenance windows

Servio can update itself from GitHub Releases. An admin schedules the update as a **maintenance window**: users are warned in advance, see a maintenance page while the window runs, and the admins are told how it ended. Plain maintenance (no update) uses the same windows.

This page is for operators. For the file-level map see [modules.md](./modules.md#updates--maintenance-windows); for the settings reference see [configuration.md](./configuration.md#updates--maintenance).

## How it works

```
 admin ──► /settings/updates ──► MaintenanceWindow (database)
                                      │
                         maintenance tick (every 15 s)
                                      │
             ┌────────────────────────┼─────────────────────────┐
             ▼                        ▼                         ▼
   SERVIO_STATE_DIR/          SERVIO_STATE_DIR/         SERVIO_STATE_DIR/
   maintenance.json      updater/request.json  ◄──►  updater/status.json
   (read by proxy.ts)         (app → updater)         updater/heartbeat.json
                                                         (updater → app)
```

1. **Discovery.** The `update-check` tick asks `https://api.github.com/repos/<UPDATE_REPOSITORY>/releases` every six hours (and on **Check now**). Releases newer than the running version are cached; the admins get one notification per new version.
2. **Scheduling.** An admin picks a release (or plans general maintenance), sets start, duration, how far ahead to announce it, a message for users, and whether to block access. The window is validated server-side: it must end after it starts, last at most 24 hours, not start in the past, not overlap another open window, and (for updates) target a newer version while the updater is connected.
3. **Announcing.** From `startsAt − announceHours` a banner appears in the console and the portal. The window also shows on the change calendar and on the status pages (`/status`, `/portal/status`).
4. **Running.** At `startsAt` the maintenance tick moves the window to `IN_PROGRESS`. If it blocks access, `maintenance.json` is written and `proxy.ts` serves the maintenance page (HTTP 503 with `Retry-After`) to everyone except admins. Admins keep full access and see a "Maintenance mode is on" banner.
5. **Updating.** For an update window the tick writes `updater/request.json`. The **updater** (a separate container, see below) pulls the image, backs up the database, replaces the app container and waits for it to become healthy. It reports each step in `updater/status.json`; the tick copies the log into the window.
6. **Finishing.** A general window ends at `endsAt` (or earlier with **End now**). An update window ends when the updater reports `SUCCEEDED` (`COMPLETED`), `FAILED` or `ROLLED_BACK`. After a successful switch the **new** container's tick finalizes the window, so the maintenance page stays up until the new version is serving. If the updater reports nothing within an hour after `endsAt`, the window fails with "Updater did not report a result". An update whose target is no longer newer than the running version fails at start with "Already running <version>".

The maintenance page, the banners and the Settings › Updates screens follow each viewer's UI
language ([i18n.md](./i18n.md)); the window's title and message are shown as the admin wrote them.

Window states: `SCHEDULED` → `IN_PROGRESS` → `COMPLETED` / `FAILED` / `ROLLED_BACK`, or `CANCELLED` (from `SCHEDULED`). A scheduled window whose end passed while Servio was not running never starts and is marked `FAILED`.

## Setup

The published image targets SQLite (`DATABASE_URL=file:/data/servio.db`). Use [`docker-compose.release.yml`](../docker-compose.release.yml): it runs `web`, `gotenberg`, a **`docker-proxy`** and the **`updater`** sidecar from published images.

- `web` and `updater` run as the same unprivileged user (`node`, uid 1000) and share the `servio-data` volume at `/data`. `SERVIO_STATE_DIR` is `/data/state` in the image.
- Only `docker-proxy` ([wollomatic/socket-proxy](https://github.com/wollomatic/socket-proxy), pinned by digest) mounts `/var/run/docker.sock`. It serves a filtered unix socket on the `docker-api` volume, owned by a uid/gid (64999) used by nothing else (socket 0660); only the proxy and the updater mount it and are in that group, and both run without a network, so nothing else can reach the filtered API. It enforces a path allowlist of the Docker calls the updater makes, scoped to `servio-web`, its `-pre-<version>` twin and full container ids (no container list, no short ids, so other containers on the host cannot be discovered), and refuses host bind mounts; request bodies and query strings are not inspected otherwise. A `web` that bind-mounts host directories needs them listed in the proxy's `-allowbindmountfrom` and the updater's `ALLOW_BIND_MOUNTS_FROM`; otherwise the update is refused before anything changes. Set `DOCKER_GID` in `.env` to the group of the Docker socket (`stat -c %g /var/run/docker.sock`).
- The updater has its own volume `servio-backups` at `/backups` (database backups, the crash-recovery journal, the record of handled requests and its liveness stamp). The app never mounts it.
- The updater only ever pulls `SERVIO_IMAGE` (set by the updater's own environment, never taken from a request) and only manages the container labelled `servio.updater.managed=true` (`SERVIO_CONTAINER` names it; required with the proxy, and renaming the container means updating the proxy's container rules too).
- The web container's `DATABASE_URL` must be an absolute `file:` URL equal to the updater's `DB_FILE` (`file:/data/servio.db`); relative URLs are refused.
- Keep `SERVIO_VERSION` in `.env` in sync with what the updater installed, or use `latest` (it follows stable releases only): a later manual `docker compose up` recreates `web` from the compose tag and would otherwise roll the update back.
- An operator who prefers to skip the proxy can mount the socket into the updater (`DOCKER_SOCKET=/var/run/docker.sock`), but then the updater needs access to the socket's group and a compromised updater gets the unfiltered Docker API. The proxy is the supported setup. Full variable list: [`updater/README.md`](../updater/README.md).
- Prereleases are installed only with `ALLOW_PRERELEASE=true` on the updater.

`/settings/updates` shows the updater as **Connected** when its heartbeat is less than 60 seconds old and Docker is reachable. Without it, update windows cannot be scheduled (general maintenance still works).

Outside Docker (`pnpm dev`, a plain Node deployment) the app writes the state files to `./.servio-state`, but there is no updater: use the general maintenance windows only.

## Security

The app is internet-facing, so the updater assumes that everything the app's user can write on `/data` is attacker-controlled. The worst that should be possible through the updater is to trigger an update to a strictly newer, stable, legitimate release of `SERVIO_IMAGE`.

- **Docker access is powerful.** Creating containers can mean root on the host. Only `docker-proxy` touches the socket; the app never does. The proxy's socket is reachable only by the updater. It has a path allowlist (inspect, pull, create, start, stop, rename, update, connect, remove, ping) and refuses host `Binds`/bind mounts; request bodies and query strings are not inspected otherwise. A privileged container or an image import (`images/create?fromSrc=`) would therefore pass, so code execution inside the updater process still means control of the host: use the stack only on hosts where that is acceptable.
- **No root file work.** The updater runs as `node` (uid 1000) with a read-only root filesystem, no capabilities, no network and `no-new-privileges`. It has no more file privileges on `/data` than the app, and the shared files are only ever data to it. Its state of record (journal, handled requests, liveness for the container health check) lives on `/backups`, not on `/data`.
- **Defence in depth on `/data`.** The database, its `-wal`, `-shm` and `-journal` files and `request.json` must be regular files and the state directories real directories (symlinks are refused, FIFOs cannot block); `request.json` may not exceed 64 KB; status writes cannot be redirected by swapping a directory; backups never overwrite an existing file; a restore goes through a temporary file and a rename.
- **Requests.** The updater accepts a strict `X.Y.Z` version (prereleases with `ALLOW_PRERELEASE=true`), builds the image reference itself, installs only versions newer than the running one and refuses when the running version is unknown (`ALLOW_DOWNGRADE=true` overrides both), rejects requests older than an hour (`REQUEST_MAX_AGE_SECONDS`) or from the future, re-reads the request before stopping the app, and requires the pulled image's version label to match. The container is created from the pulled image's id, and the id and digest are logged in the window's log. A request id runs at most once, and after an update that took the app down without succeeding the same version is refused for an hour (`RETRY_COOLDOWN_SECONDS`).
- `maintenance.json` and the `updater/` files are plain JSON on the shared volume; a compromised app can ask for an update to a newer release, or show admins a false status, nothing more.
- **Backups are untrusted data.** They are copies of a file the app can write. Inspect them only with SQLite tools where a malformed file does no harm, and do not restore one taken after a suspected compromise.
- `GET /api/maintenance` is public and returns only the title, message, planned end and kind.

## What rollback does and does not cover

When the new container fails its health check or exits, the updater stops it, restores the database copy taken just before the switch, renames the old container back and starts it. The window ends as `ROLLED_BACK`.

- **Covered:** the SQLite database file (`servio.db` plus `-wal`/`-shm`/`-journal`) as it was at the start of the update, and the old container with its original configuration and restart policy.
- **Not covered:** attachments written to the upload volume during the window (they are not part of the backup), changes in external systems, and anything users did between the backup and the restore (users are locked out during the window if it blocks access, so this only matters for non-blocking windows).
- If the rollback itself fails, the window ends `FAILED` with a "ROLLBACK FAILED — manual action required" message that names the backup path and the old container.
- A failure *before* the switch (pull failed, validation failed) leaves the running container untouched and ends `FAILED`.

Backups live on the updater's own volume at `/backups` (newest five by default, pruned whenever an update ends and never including the backup of that update). If Docker or the proxy stops answering during a rollback, the updater does not give up: it retries for three minutes, then keeps the journal (updates stay blocked) and retries on every poll until Docker answers, and only then reports the outcome. Manual-action messages include the database backup and the `docker update --restart …` command, because the previous container may still carry the restart policy `no` the update gave it.

Before stopping the app the updater writes a journal next to the backups. If the updater itself is killed mid-update, its next start finishes or reverts the work: the old container is started again (database restored if the switch had begun and no restore happened yet) or, if the new container had already proved healthy, the old container is removed and the window ends `COMPLETED`. It does so only while the containers still look the way the journal says; if you changed them by hand, or a rollback failed, it touches nothing, reports `MANUAL ACTION REQUIRED` / `ROLLBACK FAILED`, and keeps the journal as `/backups/.journal.manual-<time>.json`. Further updates are refused until you have fixed the containers and deleted that file (`docker compose -f docker-compose.release.yml exec updater rm /backups/.journal.manual-<time>.json`). A leftover `<name>-pre-<version>` container (from a failed removal or rollback) also blocks further updates until you remove it with `docker rm`, because it may be the only copy of the previous version.

The app image itself refuses to start on a database that holds migrations it does not ship, so an older version never runs on a schema a newer one migrated (`ALLOW_UNKNOWN_MIGRATIONS=true` on `web` overrides this).

## Postgres

The automatic backup copies the SQLite file. For a PostgreSQL deployment the updater refuses to run unless `ALLOW_UPDATE_WITHOUT_BACKUP=true`, in which case **you** are responsible for a database backup and for restoring it after a rollback. Migrations run when the new container starts, and a rollback does not undo them.

## Reverse proxy tip

Replacing the container takes roughly 30–60 seconds, during which the reverse proxy gets connection errors from the upstream. Serve a static "back soon" page on 502/503/504 so users do not see a raw proxy error. For nginx:

```nginx
error_page 502 503 504 /maintenance-static.html;
location = /maintenance-static.html { root /srv/static; internal; }
```

While the app is up and a window blocks access, Servio itself serves the maintenance page; the static page only covers the switch.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Updater shows "Not detected" | The `updater` container is not running or does not share the `servio-data` volume. |
| Update failed with "Refusing to install …" | The requested version is not newer than the installed one, or the installed version is unknown (no version label). Set `ALLOW_DOWNGRADE=true` on the updater only if you really want that (the database is not migrated back). |
| Update failed with "An earlier update needs manual attention" | A journal was set aside after a failed rollback or a manual change. Check `docker ps -a`, then delete `/backups/.journal.manual-*.json` in the updater container. |
| Update failed with "failed recently; it can be retried after …" | The same version failed less than `RETRY_COOLDOWN_SECONDS` ago. Wait, or pick another release. |
| Updater shows "Not responding" right after setup | `DOCKER_GID` does not match the group of `/var/run/docker.sock`, so the proxy cannot reach Docker (`dockerOk: false`). |
| Update failed with "must be an absolute file: URL equal to the updater's DB_FILE" | `DATABASE_URL` of the web container differs from the updater's `DB_FILE`, or is relative. |
| Update failed with "already exists from an earlier update" | A `servio-web-pre-<version>` container is left over. Check which container is the right one, then `docker rm` the other. |
| Updater shows "Not responding" | Heartbeat older than 60 s: the updater crashed, or Docker is unreachable from it (`dockerOk: false`). |
| Update window failed with "Updater not reachable" | The updater was offline at `startsAt`. Nothing was changed. |
| Window stuck `IN_PROGRESS` after the update | The new container is unhealthy or its scheduler is disabled (`SCHEDULER_ENABLED=false`): the maintenance tick finalizes the window. |
| Everyone sees the maintenance page | A blocking window is `IN_PROGRESS`. End a general window with **End now** on `/settings/updates`. A running update that never reports a result can be released with **Abort**: it marks the window `FAILED` and gives users access back, but does not stop the updater, so check the updater's log first. Deleting `maintenance.json` does not help: the app rewrites it from the database on the next tick. |
