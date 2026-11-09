# Backup & restore

Servio backs itself up. On a schedule (daily at 02:30 UTC by default) and on demand, it takes a
consistent online copy of the SQLite database and an archive of the uploaded attachments, verifies
both, keeps the newest backups according to a retention policy and records every run. Restoring
is one script that ships in the image. No host cron job is needed.

See also: [deployment.md](./deployment.md) · [configuration.md](./configuration.md) ·
[updates.md](./updates.md) (the separate pre-update database backup) · [rest-api.md](./rest-api.md).

## 🧭 At a glance

| | |
| --- | --- |
| What is backed up | The SQLite database (`DATABASE_URL=file:…`) and the upload directory (`UPLOAD_DIR`, `STORAGE_DRIVER=fs`). |
| How | `VACUUM INTO` (a transactionally consistent, compacted copy taken while the app keeps running) and a `tar.gz` of the uploads, written by a child process so the web server never blocks. |
| Verified | Every backup, before it is kept: checksums, `PRAGMA integrity_check` on the copy opened read-only, row counts of the core tables against the live database, the archive read back end to end. A backup that fails is deleted and the run is recorded as failed. |
| Where | `BACKUP_DIR`: `/data/backups` in the Docker image (on the persistent `servio-data` volume), `./.backups` otherwise. |
| When | Scheduled backups are **on by default** (daily 02:30 UTC). Settings › Backups changes the schedule, time zone, retention and whether attachments are included, and has **Back up now**. |
| Retention | The newest 7 backups and every backup younger than 14 days are kept; older ones are deleted after each successful backup. |
| Monitoring | `GET /api/v1/system/backups/latest` (agent token, `read` scope) and an admin notification when a scheduled backup fails. |
| Restore | `node scripts/restore-backup.mjs` with the app stopped; `--dry-run` verifies first. |
| Not covered | PostgreSQL deployments (use `pg_dump`), non-filesystem storage drivers, and anything outside the database and uploads (the `.env`, compose files, `SERVIO_STATE_DIR`). |

## 📦 What a backup contains

Each backup is one directory in `BACKUP_DIR`:

```
servio-backup-20261119T023000Z/
  servio.db            VACUUM INTO copy of the database (no -wal/-shm needed)
  uploads.tar.gz       every file below UPLOAD_DIR (absent when attachments are excluded)
  manifest.json        sizes, sha256 checksums, applied migrations, live row counts, app version
  verification.json    the checks the backup passed
```

A backup is written into a `.partial-…` directory first and renamed into place only after it
passed verification, so a directory with the final name is always complete and verified. Partial
directories left by an interrupted run are removed after 12 hours. The archive is a standard
POSIX tar (`tar tzf uploads.tar.gz` lists it). Temporary files of uploads in flight (`*.tmp`)
and symlinks are skipped.

The Settings page deliberately offers **no download**: a backup holds every record, password
hash and encrypted setting. Copy backups off the server with your usual tools (for example
`docker run --rm -v servio_servio-data:/data -v "$PWD":/out alpine cp -r /data/backups /out`,
or rsync/restic/borg on the volume's host path).

> **Keep a copy off the host.** By default backups live on the same volume as the data: they
> protect against corruption, mistakes and failed changes, not against losing the disk. Mount a
> separate disk at `BACKUP_DIR` (and set the variable), and/or copy `BACKUP_DIR` off the host
> regularly. Also back up your `.env`: `SETTINGS_ENCRYPTION_KEY` is needed to decrypt the
> secrets stored in the database, and `AUTH_SECRET` keeps sessions valid.

## ✅ Verification ("restore test light")

| Check | Fails the backup when |
| --- | --- |
| Checksum | The copy or the archive no longer matches the sha256 in the manifest. |
| `PRAGMA integrity_check` | The copy, opened read-only, reports anything but `ok`. |
| Row counts | A core table (`User`, `Group`, `Ticket`, `TicketComment`, `Problem`, `Change`, `Asset`, `Attachment`, `Article`, `AuditLog`, `AppSetting`, `ApiToken`) is missing or its count is outside the live counts taken right before and after the snapshot. |
| Migrations | The applied migrations of the copy differ from the manifest. |
| Archive | The `tar.gz` cannot be read to the end (gzip CRC, tar checksums, end marker), holds links or devices, or its file count or size differs from what was written. |
| Referenced files | A `storageKey` in the copied database has no file in the archive. This is only a **warning** (the file was usually already missing on disk) and is shown on the run. |

The same checks (without the live comparison) run again before every restore.

## ⚙️ Configuration

Admin settings (Settings › Backups) override the environment variables of the same name; see
[configuration.md](./configuration.md#built-in-backup) for the full list.

| Setting / variable | Default | Meaning |
| --- | --- | --- |
| `BACKUP_DIR` (env only) | `/data/backups` (image), `./.backups` | Where backups are written. Must not lie inside `UPLOAD_DIR`. |
| `BACKUP_ENABLED` | `true` | Scheduled backups on/off. Back up now works either way. |
| `BACKUP_SCHEDULE` | `02:30` | A daily time `HH:MM` or a five-field cron expression; at most hourly. |
| `BACKUP_TIMEZONE` | `UTC` | IANA time zone the schedule is read in. |
| `BACKUP_RETENTION_COUNT` | `7` | Always keep this many of the newest backups (minimum 1). |
| `BACKUP_RETENTION_DAYS` | `14` | Also keep every backup younger than this many days (0 = by count only). |
| `BACKUP_INCLUDE_UPLOADS` | `true` | Archive the upload directory with the database. |

A run that is due while the server is down is caught up once when it is back. A run interrupted
by a restart is marked failed after three minutes without a heartbeat. Only one backup runs at a
time. Scheduled backups run on the scheduler instance (`SCHEDULER_ENABLED=true`, see
[deployment.md](./deployment.md)). Free space is checked first: the backup directory needs room
for the database, the uploads and 64 MB.

## 📈 Monitoring

`GET /api/v1/system/backups/latest` returns the newest run and the newest verified one:

```json
{
  "data": {
    "status": "SUCCESS",
    "verified": true,
    "finished_at": "2026-11-19T02:31:04.000Z",
    "age_seconds": 34500,
    "size_bytes": 48211968,
    "last_success_at": "2026-11-19T02:31:04.000Z",
    "last_success_age_seconds": 34500,
    "enabled": true,
    "supported": true,
    "schedule": "02:30",
    "timezone": "UTC",
    "next_run_at": "2026-11-20T02:30:00.000Z"
  }
}
```

Alert when `last_success_age_seconds` exceeds the schedule plus a margin (for a daily backup,
for example 26 hours = 93600 s), or when `status` is `FAILED`. `status` is `NONE` before the first
run. Use a token of an agent account with the `read` scope (Settings › API Tokens). Field reference:
[rest-api.md](./rest-api.md#built-in-backup). Admins also get an in-app notification
(`BACKUP_FAILED`) whenever a scheduled backup fails.

## ♻️ Restore

Restoring replaces the database and the upload directory with a backup. **The app must be
stopped.** The script refuses while the app's heartbeat file (`app-heartbeat.json` in
`SERVIO_STATE_DIR`) is fresh or the database is locked; `--force` overrides. It keeps the current
database and upload directory as `*.pre-restore-<time>` next to the originals and deletes nothing.

### Docker (published images)

```bash
# 0. Pick a backup.
docker compose -f docker-compose.release.yml run --rm --no-deps --entrypoint node web \
  scripts/restore-backup.mjs --list

# 1. Stop the app (the updater and Gotenberg may keep running).
docker compose -f docker-compose.release.yml stop web

# 2. Verify the backup and show the plan. Nothing is changed.
docker compose -f docker-compose.release.yml run --rm --no-deps --entrypoint node web \
  scripts/restore-backup.mjs servio-backup-20261119T023000Z --dry-run

# 3. Restore.
docker compose -f docker-compose.release.yml run --rm --no-deps --entrypoint node web \
  scripts/restore-backup.mjs servio-backup-20261119T023000Z --yes

# 4. Start the app; newer migrations, if any, are applied at boot.
docker compose -f docker-compose.release.yml start web
```

`--entrypoint node` skips the image's boot script (which would migrate the current database
first); `run` uses the same volumes and environment as `web`. With `docker-compose.yml` (built from
source) use that file instead. `latest` instead of a name picks the newest verified backup.

### From source

```bash
# with the app stopped, in the app directory, with the app's environment loaded
node scripts/restore-backup.mjs --list
node scripts/restore-backup.mjs latest --dry-run
node scripts/restore-backup.mjs latest --yes
```

Run it as the user the app runs as, so the restored files keep the right owner.

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `--list` | | List the backups in the backup directory. |
| `--dry-run` | | Verify the backup and print the plan; change nothing. |
| `--yes` | | Restore (required for a real restore). |
| `--skip-uploads` | | Restore the database only. |
| `--force` | | Restore although the app looks alive, the database is locked, or the backup comes from a newer version. |
| `--backup-dir DIR` | `BACKUP_DIR`, else `./.backups` | Where the backups are; a path to a backup directory works as the name too. |
| `--db FILE` | the SQLite file of `DATABASE_URL` | The database to replace. |
| `--uploads DIR` | `UPLOAD_DIR`, else `./.uploads` | The upload directory to replace. |
| `--state-dir DIR` | `SERVIO_STATE_DIR`, else `./.servio-state` | Where the app's heartbeat file is. |
| `--migrations-dir DIR` | `./prisma/migrations` | The migrations this version ships, for the version check. |

### What the script does

1. Verifies the backup (checksums, `integrity_check`, archive read end to end). A backup that
   fails is never restored.
2. Compares the backup's migrations with the ones this version ships. A backup made by a newer
   version is refused (this version would not start on it); run that version instead. Migrations
   newer than the backup are applied when the app starts.
3. Checks that the app is stopped.
4. Copies the current database (and its `-wal`/`-shm`/`-journal` files) to
   `<db>.pre-restore-<time>`, removes the old sidecar files (replaying them onto the restored
   database would corrupt it) and puts the backup in place via a temporary file and a rename.
5. Unpacks the archive next to the upload directory, moves the current directory aside to
   `<uploads>.pre-restore-<time>` and renames the restored one into place. When the upload
   directory is a mount point, the swap happens inside it (`<uploads>/.pre-restore-<time>/`).
   If this step fails, the previous database is put back.

Afterwards sign in, check recent tickets and a few attachments, and delete the
`*.pre-restore-*` copies when you are satisfied.

### Restoring onto a new server

Install Servio as in [deployment.md](./deployment.md) with the same `.env` (in particular
`SETTINGS_ENCRYPTION_KEY` and `AUTH_SECRET`) but do not start `web`. Copy the backup directory
into the new backup volume (for example with `docker compose cp` or a helper container), then run
steps 2–4 above. The script creates the database and upload directory when they do not exist yet.

### Without the script

A backup is plain files: with the app stopped, copy `servio.db` over the database file, delete the
database's `-wal`, `-shm` and `-journal` files, and unpack `uploads.tar.gz` into an empty upload
directory (`tar xzf uploads.tar.gz -C <UPLOAD_DIR>`). Check the copy first with
`sqlite3 servio.db "PRAGMA integrity_check"`.

## 🔁 Relation to the pre-update backup

The updater sidecar keeps its own copy of the database, taken with the app stopped right before
each update, on its own `servio-backups` volume, and restores it automatically on a rollback
([updates.md](./updates.md#what-rollback-does-and-does-not-cover)). That mechanism is unchanged and independent:
the built-in backup is for everyday recovery and covers the attachments too; the pre-update
backup only protects an update. Both use variables named `BACKUP_DIR`, set on different
containers (`web`: `/data/backups`, `updater`: `/backups`).

## 🗄️ Implementation

| Part | File |
| --- | --- |
| Backup run (create → verify → publish → retention), operator CLI | [`../scripts/backup/run.mjs`](../scripts/backup/run.mjs), [`create.mjs`](../scripts/backup/create.mjs) |
| Verification | [`../scripts/backup/verify.mjs`](../scripts/backup/verify.mjs) |
| Layout, retention, paths | [`../scripts/backup/layout.mjs`](../scripts/backup/layout.mjs) |
| SQLite access (`node:sqlite`) and the tar.gz format | [`sqlite.mjs`](../scripts/backup/sqlite.mjs), [`tar.mjs`](../scripts/backup/tar.mjs) |
| Restore | [`../scripts/restore-backup.mjs`](../scripts/restore-backup.mjs) |
| Run records, lock, audit, notifications | [`../lib/backup.ts`](../lib/backup.ts), model `BackupRun` |
| Schedule and monitoring rules | [`../lib/backup-rules.ts`](../lib/backup-rules.ts) |
| Scheduler ticks (`backup`, `app-heartbeat`) | [`../lib/ticks/backup.ts`](../lib/ticks/backup.ts) |
| Settings › Backups | [`../app/(console)/settings/backups/page.tsx`](../app/(console)/settings/backups/page.tsx), [`../components/backups/`](../components/backups/), [`../lib/actions/backup.ts`](../lib/actions/backup.ts) |
| Monitoring endpoint | [`../app/api/v1/system/backups/latest/route.ts`](../app/api/v1/system/backups/latest/route.ts) |

The scripts are plain Node (no dependencies, Node's built-in `node:sqlite`), so they run in the
image without the app and an operator can also start a backup by hand:
`node scripts/backup/run.mjs` (same defaults as the app; `--help` lists the options). Such a run
is not recorded in the run history.
