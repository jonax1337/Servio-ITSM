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
5. **Updating.** For an update window the tick writes `updater/request.json`, including the compressed size of the target image that the app reads from the registry manifest (best effort, see [Disk space](#disk-space-and-old-images)). The **updater** (a separate container, see below) checks the free space on Docker's data root, pulls the image, backs up the database, replaces the app container and waits for it to become healthy. It reports each step in `updater/status.json`; the tick copies the log into the window. After a successful update it removes superseded images and then replaces **itself** with the updater of the same release ([The updater updates itself](#the-updater-updates-itself)).
6. **Finishing.** A general window ends at `endsAt` (or earlier with **End now**). An update window ends when the updater reports `SUCCEEDED` (`COMPLETED`), `FAILED` or `ROLLED_BACK`. After a successful switch the **new** container's tick finalizes the window, so the maintenance page stays up until the new version is serving. If the updater reports nothing within an hour after `endsAt`, the window fails with "Updater did not report a result". An update whose target is no longer newer than the running version fails at start with "Already running <version>".
7. **Stalled updates.** A window does not wait for its planned end when the updater can no longer report. Once nothing moved for `UPDATER_STALE_MINUTES` (default 10; no status change since the request was handed over or last reported), the window fails when the updater's heartbeat has stopped as well ("The updater stopped reporting", e.g. the updater is down or the shared volume is full), or when the heartbeat says the updater is idle although this window never got a final status ("no longer working on this update", e.g. its last status write failed). A busy updater (a long pull, a health check) reports the request it works on in its heartbeat and is left alone. When the window fails this way, the app also withdraws the update request, so an updater that comes back late gives up before it stops the app instead of updating behind a window that already reads `FAILED`. The updater itself retries an unwritten status on every poll, so the outcome still lands in its log and `status.json` once the disk has room again.

The maintenance page, the banners and the Settings › Updates screens follow each viewer's UI
language ([i18n.md](./i18n.md)); the window's title and message are shown as the admin wrote them.

Window states: `SCHEDULED` → `IN_PROGRESS` → `COMPLETED` / `FAILED` / `ROLLED_BACK`, or `CANCELLED` (from `SCHEDULED`). A scheduled window whose end passed while Servio was not running never starts and is marked `FAILED`.

## Setup

The published image targets SQLite (`DATABASE_URL=file:/data/servio.db`). Use [`docker-compose.release.yml`](../docker-compose.release.yml): it runs `web`, `gotenberg`, a **`docker-proxy`** and the **`updater`** sidecar from published images.

- `web` and `updater` run as the same unprivileged user (`node`, uid 1000) and share the `servio-data` volume at `/data`. `SERVIO_STATE_DIR` is `/data/state` in the image.
- Only `docker-proxy` ([wollomatic/socket-proxy](https://github.com/wollomatic/socket-proxy), pinned by digest) mounts `/var/run/docker.sock`. It serves a filtered unix socket on the `docker-api` volume, owned by a uid/gid (64999) used by nothing else (socket 0660); only the proxy and the updater mount it and are in that group, and both run without a network, so nothing else can reach the filtered API. It enforces a path allowlist of the Docker calls the updater makes, scoped to `servio-web`, the updater's own `servio-updater`, their `-pre-<version>` twins and full container ids (no container list, no short ids, so other containers on the host cannot be discovered), and refuses host bind mounts; request bodies and query strings are not inspected otherwise. A `web` that bind-mounts host directories needs them listed in the proxy's `-allowbindmountfrom` and the updater's `ALLOW_BIND_MOUNTS_FROM`; otherwise the update is refused before anything changes. Set `DOCKER_GID` in `.env` to the group of the Docker socket (`stat -c %g /var/run/docker.sock`).
- The updater has its own volume `servio-backups` at `/backups` (database backups, the crash-recovery journal, the record of handled requests and its liveness stamp). The app never mounts it.
- The updater only ever pulls `SERVIO_IMAGE` (set by the updater's own environment, never taken from a request) and only manages the container labelled `servio.updater.managed=true` (`SERVIO_CONTAINER` names it; required with the proxy, and renaming the container means updating the proxy's container rules too).
- The web container's `DATABASE_URL` must be an absolute `file:` URL equal to the updater's `DB_FILE` (`file:/data/servio.db`); relative URLs are refused.
- Keep `SERVIO_VERSION` in `.env` in sync with what the updater installed, or use `latest` (it follows stable releases only): a later manual `docker compose up` recreates `web` from the compose tag and would otherwise roll the update back (see [Compose and the running version](#compose-and-the-running-version)).
- An operator who prefers to skip the proxy can mount the socket into the updater (`DOCKER_SOCKET=/var/run/docker.sock`), but then the updater needs access to the socket's group and a compromised updater gets the unfiltered Docker API. The proxy is the supported setup. Full variable list: [`updater/README.md`](../updater/README.md).
- Prereleases are installed only with `ALLOW_PRERELEASE=true` on the updater.

`/settings/updates` shows the updater as **Connected** when its heartbeat is less than 60 seconds old and Docker is reachable. Without it, update windows cannot be scheduled (general maintenance still works).

## Compose and the running version

The updater replaces `web` outside of compose. The new container references its image **by tag** (`ghcr.io/jonax1337/servio:<version>`, the pulled image's id is verified at create time), so `docker ps`, `docker compose ps` and monitoring show the release that actually runs. The running version is also readable:

- `GET /api/v1/health` with any valid API token returns `{"data":{"status":"ok","maintenance":false,"version":"<version>"}}` ([rest-api.md](./rest-api.md#health)); without a token it answers liveness only.
- Settings › Updates shows the installed version; the updater's `heartbeat.json` names the image of the managed container.

Compose does not know about the update. **A compose file whose `image:` names an older tag downgrades the app on the next `docker compose up -d`**: compose recreates `web` from that tag, and since the newer release already migrated the database, the older image refuses to start ("the database has migrations this image does not contain"), so the app stays down until you put the newer tag back or restore the backup taken before the update. Therefore:

- Never write a fixed tag into `image:`. Drive it from an environment variable, as `docker-compose.release.yml` does: `image: ghcr.io/jonax1337/servio:${SERVIO_VERSION:-latest}`.
- After an update from the UI, set `SERVIO_VERSION` in `.env` to the installed version (the value `GET /api/v1/health` or `docker ps` shows), or leave it on `latest`, which follows stable releases.
- Run `docker compose pull` before `docker compose up -d` when you change `SERVIO_VERSION` by hand.

## The updater updates itself

An update replaces the app container. Without more, the updater container would keep running its old release until the operator re-runs compose, so fixes to the updater would never arrive through the UI. After an update to version X ends `SUCCEEDED`, the updater therefore replaces itself with `UPDATER_IMAGE:X` (by default `ghcr.io/jonax1337/servio-updater:X`):

1. **Checks, nothing changed on failure.** Only when X is newer than the updater's own version and `UPDATER_SELF_UPDATE` is not `false`. The updater finds its own container by `UPDATER_CONTAINER` (`servio-updater` in the compose file) and confirms that it is its own: the container id must start with the updater's hostname, which Docker sets to the short container id (do not set `hostname:` on the updater). It pulls `UPDATER_IMAGE:X` and requires the image's version label to be X. A leftover `servio-updater-pre-<version>` container or an unfinished handover also stops it here.
2. **Handover.** The old updater pauses its heartbeat, turns its own restart policy off (so a Docker restart cannot bring two updaters up), renames its container to `servio-updater-pre-<version>`, creates the new container under the original name from its own configuration (environment, volumes, user, groups, read-only root, network mode and restart policy; image defaults such as the command come from the new image) and starts it. The new container references its image by tag and must resolve to the pulled image.
3. **Proof of life.** The new updater must write its liveness stamp (on `/backups`, carrying its version) within `UPDATER_SELF_UPDATE_TIMEOUT_SECONDS` (default 120) and keep running as the same instance for a few more seconds. Then the old updater records the handover and exits; the new one removes the stopped old container and cleans up superseded updater images, keeping the previous release as rollback target (`UPDATER_KEEP_IMAGES`).
4. **Rollback.** If the new updater exits, restarts, turns unhealthy or does not report in time, the old one removes it, takes its name and restart policy back and carries on. The new image stays on the host (it is newer than the running release, so the cleanup keeps it); the next update tries again with its own release.

Only one updater processes update requests at any time: while the handover record exists and the old updater runs, the new one waits. If either updater is restarted during the handover, it finishes or undoes it from the record on `/backups`.

**What admins see.** Settings › Updates shows the updater's version and the outcome of its last self-update ("Updated itself from … to …", or that it did not complete or was rolled back, with the reason). The same text is added as a note to the update's status; it reaches the window's log only while the window is still open, because the window completes as soon as the app update succeeded.

**Compose afterwards.** As with `web`, the replaced `updater` container carries stale compose labels. `docker compose up -d` may recreate it from `servio-updater:${SERVIO_VERSION}`; with `SERVIO_VERSION` in sync (or `latest`) that is the same release. With an older value it puts the older updater back, which is harmless: the next update replaces it again.

**Prerequisites.** The compose file of this release: the fixed `container_name: servio-updater`, `UPDATER_CONTAINER`, and the proxy rules that allow the calls on that name. An installation started from an older compose file keeps its updater until you re-run `docker compose up -d` once with the new file; until then the self-update is skipped with a note ("UPDATER_CONTAINER is not set"). The socket proxy itself is never replaced by a self-update: changes to its rules always need compose.

`UPDATER_SELF_UPDATE=false` turns the self-update off; the updater then follows compose only.

## Disk space and old images

Every release adds an image of several gigabytes; without housekeeping a small host fills up after a few updates and the next pull fails half-way. The updater therefore:

- **Checks the space before pulling.** It measures the free space on the filesystem that holds Docker's data root (by default through its `/backups` volume, a named volume stored under the data root; point `PULL_SPACE_PROBE_DIR` at another mount if your volumes live elsewhere). With the containerd image store (the default for new installations of Docker Engine 29) images live under `/var/lib/containerd` instead; if that is a separate filesystem, mount a directory of it into the updater as `PULL_SPACE_PROBE_DIR` or turn the check off. It needs the compressed download, the unpacked layers and `PULL_SPACE_MARGIN_MB` (default 1024). The sizes come from the registry manifests, read by the app (`SERVIO_IMAGE` on the app, default `ghcr.io/jonax1337/servio`, anonymous pull tokens only): only the layers the running release does not share count as download, and the unpacked size is the installed image's size scaled to that share. When the app cannot read them, the installed image's size stands in for both. When space is short it first removes superseded images (below) and measures again; if it is still short the update ends `FAILED` with "Not enough free space for the image pull: … Nothing was changed." An image that is already on the host needs no room. Every check leaves a line in the window's log (and in the updater's container log, with the exact byte counts): "Free space for the pull: 9.4 GB free on the filesystem of /backups (Docker's data root), 2.1 GB needed for … (1.0 GB download, 1.1 GB unpacked, 1.0 GB margin).", or "Space check skipped: …" naming the reason (image already present, `PULL_SPACE_CHECK=false`). `PULL_SPACE_CHECK=false` turns the check off.
- **Removes superseded images after a successful update.** Images of the two managed repositories (`SERVIO_IMAGE` and the updater's own `UPDATER_IMAGE`, by default `<SERVIO_IMAGE>-updater`) whose version is older than the one now running are removed, except the newest `UPDATER_KEEP_IMAGES` (default 1). The image the replaced container ran always counts as the newest (it is recognised by its id, not by its labels), so it stays as the rollback target. Never removed: the running images, releases newer than the running one, images whose version cannot be told, images that also carry a reference of another repository, images with several tags (Docker would untag such an image even under a running container instead of refusing), and images a container still uses (removal is never forced, so Docker refuses with a conflict; the status lists them as kept). The updater's own repository follows the same rules: the running updater release (its own version) is never removed, the newest older release stays as its rollback target and `UPDATER_KEEP_IMAGES` applies. The updater is replaced by its self-update or by the operator (compose), so its cleanup also runs once when the updater starts: images the new updater supersedes do not wait for the next app update, and the previous updater release stays as the rollback target. The cleanup after an update runs after the update is reported `SUCCEEDED` and adds a note naming every image removed. `PRUNE_IMAGES=false` turns the cleanup off. Nothing is removed after a failed or rolled-back update.

Outside Docker (`pnpm dev`, a plain Node deployment) the app writes the state files to `./.servio-state`, but there is no updater: use the general maintenance windows only.

## Security

The app is internet-facing, so the updater assumes that everything the app's user can write on `/data` is attacker-controlled. The worst that should be possible through the updater is to trigger an update to a strictly newer, stable, legitimate release of `SERVIO_IMAGE`.

- **Docker access is powerful.** Creating containers can mean root on the host. Only `docker-proxy` touches the socket; the app never does. The proxy's socket is reachable only by the updater. It allows exactly the calls the updater makes: ping; inspect, start, stop, rename, update and remove of `servio-web`, its `-pre-<version>` twin or a full container id; create; network connect; pull; inspect of images of the two managed repositories (or by full image id); the image list; and removal of images of the managed repositories by `repo:tag` or `repo@sha256:…` only (never by id, never forced). It refuses host `Binds`/bind mounts; request bodies and query strings are not inspected otherwise.
- **Self-update.** For it the proxy additionally allows inspect, start, stop, rename, update and remove of the names `servio-updater` and `servio-updater-pre-<version>` (create, and the same calls by full container id, were allowed already). The new risk is a supply-chain one: a published release of `UPDATER_IMAGE` (or a registry that serves a forged image under the release tag) runs with the updater's privileges without an operator re-running compose. The updater accepts only a newer version of its own repository with the matching version label, and only after an app update to exactly that version succeeded, which an admin has to schedule; set `UPDATER_SELF_UPDATE=false` if updater releases should only be adopted by hand. If the host crashes in the seconds between the rename and the start of the new updater, no updater runs afterwards (the old one has restart policy `no`); the app is not affected, and `docker start servio-updater-pre-<version>` or `docker compose up -d` brings one back, which finishes or undoes the handover.
- **Residual risk.** Because bodies and query strings pass unchecked, a create request for a privileged container, an image import (`images/create?fromSrc=`), a pull of any image from any repository (`images/create?fromImage=<any repository>`: the repository is a query parameter, so the image scoping does not cover pulls), query flags such as `?force=true` on the allowed calls (for example a forced removal of a managed image), a container name chosen on create or rename, and the full image list (`images/json` with any filter) are still possible for whoever controls the updater process; removals are limited by path to the managed repositories. Code execution inside the updater process therefore still means control of the host: use the stack only on hosts where that is acceptable. Full table of rules: [`updater/README.md`](../updater/README.md#threat-model).
- **No root file work.** The updater runs as `node` (uid 1000) with a read-only root filesystem, no capabilities, no network and `no-new-privileges`. It has no more file privileges on `/data` than the app, and the shared files are only ever data to it. Its state of record (journal, handled requests, liveness for the container health check) lives on `/backups`, not on `/data`.
- **Defence in depth on `/data`.** The database, its `-wal`, `-shm` and `-journal` files and `request.json` must be regular files and the state directories real directories (symlinks are refused, FIFOs cannot block); `request.json` may not exceed 64 KB; status writes cannot be redirected by swapping a directory; backups never overwrite an existing file; a restore goes through a temporary file and a rename.
- **Requests.** The updater accepts a strict `X.Y.Z` version (prereleases with `ALLOW_PRERELEASE=true`), builds the image reference itself, installs only versions newer than the running one and refuses when the running version is unknown (`ALLOW_DOWNGRADE=true` overrides both), rejects requests older than an hour (`REQUEST_MAX_AGE_SECONDS`) or from the future, re-reads the request before stopping the app, and requires the pulled image's version label to match. The container is created from the release tag and must resolve to the pulled image's id (a tag moved in between rolls the update back); the id and digest are logged in the window's log. The download sizes in the request only feed the free-space check (implausible values are ignored); a forged one can at most make the updater refuse an update. A request id runs at most once, and after an update that took the app down without succeeding the same version is refused for an hour (`RETRY_COOLDOWN_SECONDS`).
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

Everyday backups of the database **and the attachments** are a separate, built-in feature that
runs on a schedule inside the app (Settings › Backups, [backup.md](./backup.md)). The pre-update
backup described here is unchanged by it.

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
| Update failed with "Not enough free space for the image pull" | Docker's data root lacks room for the new image even after the cleanup of superseded images. Free space (`docker system df`, `docker image prune`), then schedule the update again. If your Docker volumes live on another filesystem than the data root, set `PULL_SPACE_PROBE_DIR`. |
| Update window failed with "The updater stopped reporting" | No heartbeat for `UPDATER_STALE_MINUTES` while the update ran: the updater died or the shared volume is full. Check `docker ps -a` (is `servio-web` running?) and the updater's log; it retries the final status once it can write again. |
| Update window failed with "no longer working on this update" | The updater is alive but never wrote a final status for this window, most likely because the write failed (full disk). Its log has the outcome. |
| `docker compose up` brought back an older version, which refuses to start | The compose tag lags behind the version the UI installed. Set `SERVIO_VERSION` to the installed version and run `docker compose up -d` again ([Compose and the running version](#compose-and-the-running-version)). |
| Settings › Updates: the self-update did not complete, "UPDATER_CONTAINER is not set" | The installation still runs the compose file of an older release. Run `docker compose -f docker-compose.release.yml up -d` once with the current file. |
| Self-update did not complete: "is not this updater" | `hostname:` is set on the updater, or `UPDATER_CONTAINER` names another container. Remove the hostname, or fix the name (and the proxy's container rules with it). |
| Self-update failed and was rolled back | The new updater did not report in time, exited or restarted; the reason is in the message and the updater's log. The previous updater keeps running and the next update tries again. |
| Self-update needs manual action | Undoing a self-update failed. Keep exactly one updater container, named `servio-updater` with restart policy `unless-stopped` (`docker rm` the other, `docker rename`, `docker update --restart unless-stopped`), then delete `/backups/.self-update.manual-*.json`. |
| Window stuck `IN_PROGRESS` after the update | The new container is unhealthy or its scheduler is disabled (`SCHEDULER_ENABLED=false`): the maintenance tick finalizes the window. |
| Everyone sees the maintenance page | A blocking window is `IN_PROGRESS`. End a general window with **End now** on `/settings/updates`. A running update that never reports a result can be released with **Abort**: it marks the window `FAILED` and gives users access back, but does not stop the updater, so check the updater's log first. Deleting `maintenance.json` does not help: the app rewrites it from the database on the next tick. |
