# Deployment

Production deployment guide for Servio. There are two ways to run it:

| Path | When | Section |
| --- | --- | --- |
| **Published Docker images** (recommended) | Any Linux host with Docker Compose. No clone, no Node toolchain, self-update from the UI. | [Docker](#-docker) |
| **Build from source** | You need PostgreSQL, a patched build, or a platform without Docker. | [Database](#️-database-sqlite--postgresql) · [Build & run](#️-build--run) |

The rest of the page covers the production environment, persistent file storage, and
how scheduled background work runs.

For the full list of environment variables and their meaning, see
[configuration.md](./configuration.md). For the schema itself, see
[data-model.md](./data-model.md).

Application builds validate committed brand assets before Next.js runs. Keep
the canonical `branding` sources and synced `public/brand` / `app` files in
the build context. Local Manrope is compiled from `branding/fonts` into Next's
static font output. Normal deployment does not require the Python/browser
tools used to author the full brand kit. See [branding.md](./branding.md).

---

## 🐳 Docker

Two compose files ship with the repo:

| File | Images | Use it for |
| --- | --- | --- |
| [`docker-compose.release.yml`](../docker-compose.release.yml) | Published `ghcr.io/jonax1337/servio` + `servio-updater` | **Production.** App, Gotenberg, the updater sidecar and its Docker socket proxy. |
| [`docker-compose.yml`](../docker-compose.yml) | Built locally from the [`Dockerfile`](../Dockerfile) | Testing your own build (`docker compose up --build`); `docker compose up -d gotenberg` alone gives local `next dev` office previews on host `:3001`. |

### Install from the published images

You only need the compose file and an `.env` next to it:

```bash
mkdir servio && cd servio
curl -fsSLO https://raw.githubusercontent.com/jonax1337/Servio-ITSM/main/docker-compose.release.yml
cat > .env <<EOF
AUTH_SECRET=$(openssl rand -base64 32)
SETTINGS_ENCRYPTION_KEY=$(openssl rand -base64 32)
DOCKER_GID=$(stat -c %g /var/run/docker.sock)
# Public origin, when serving on a domain behind a reverse proxy:
# APP_URL=https://servicedesk.example.com
# AUTH_URL=https://servicedesk.example.com
# Pin a release instead of following `latest`:
# SERVIO_VERSION=0.3.1
EOF
docker compose -f docker-compose.release.yml up -d
```

- `AUTH_SECRET` signs sessions; `SETTINGS_ENCRYPTION_KEY` (32 bytes) encrypts secrets saved in
  **Settings** (SMTP password, AI keys, sync credentials). Without it those fields cannot be
  saved. Keep both stable: changing the key makes stored secrets unreadable.
- `DOCKER_GID` is **required** by the compose file (it refuses to start without it): the group
  of the host's Docker socket, used by the socket proxy the updater talks to. See
  [updates.md](./updates.md#setup).
- Everything else in [configuration.md](./configuration.md) (SMTP, OIDC, AI, rate limits…) also
  goes into this `.env`; most of it can instead be set later in **Settings**.

> **Demo data on first boot.** The entrypoint seeds the database once per volume with the
> demo organisation: users such as `admin@servio.dev` with password `servio123`, and the
> read/write API token `servio_demo_pat_0123456789abcdef`. On a real deployment, log in,
> change every seeded password (or remove the accounts) and revoke the demo token under
> **Settings › API Tokens** before exposing the instance.

Upgrades are installed from **Settings › Updates** (see [updates.md](./updates.md)). If you
pinned `SERVIO_VERSION`, bump it in `.env` after an in-app update, or a later
`docker compose up` recreates `web` from the old tag.

### How the image behaves

- **Database.** Both compose files default to **SQLite on the `/data` volume**
  (`DATABASE_URL=file:/data/servio.db`, set in the compose file; the image itself ships
  **no baked-in DATABASE_URL**). The published image is built from the committed schema,
  so it targets SQLite. To run Postgres instead, switch `datasource.provider` to
  `postgresql` in [`prisma/schema.prisma`](../prisma/schema.prisma) (see
  [below](#️-database-sqlite--postgresql)), build your own image with `docker-compose.yml`,
  uncomment its `db` service and repoint `DATABASE_URL`.
- **Uploads.** Blob storage is redirected to `/data/uploads` (same volume) via
  `UPLOAD_DIR`, so DB + files persist together.
- **Boot.** [`docker/entrypoint.sh`](../docker/entrypoint.sh) runs `prisma migrate deploy`
  (the committed baseline migration is kept current), **refuses to start** when the
  database holds migrations the image does not ship (a newer version migrated it;
  `ALLOW_UNKNOWN_MIGRATIONS=true` overrides), seeds once per volume (`/data/.seeded`),
  then starts Next with `next start` (not `pnpm start`, whose dependency check would try to
  write to the read-only `/app`). Migration failures abort boot (`set -e`).
- **Health.** The image defines a `HEALTHCHECK` (GET `/login`) and the compose file adds
  matching healthchecks for `web` and `gotenberg`; `web` waits for Gotenberg's `/health`
  before starting.
- **Scheduler.** The container defaults to `SCHEDULER_ENABLED=true`. If you run more than
  one replica of this stack, set `SCHEDULER_ENABLED=false` on all but one — see the
  single-instance warning under [Build & run](#️-build--run).
- **Office previews.** The web service sets `GOTENBERG_URL=http://gotenberg:3000`
  automatically. Documents (docx/pptx/legacy/ODF) then render as a faithful PDF in the
  lightbox; without it, Servio falls back to a best-effort text/HTML preview.
- **Sable (AI agent).** The image ships `sable/` (agent charter + built-in ITSM skills);
  at runtime they are synced into Sable's isolated home `SABLE_HOME` (default
  `~/.servio/sable`). Custom skills and MCP servers live in the database, so nothing
  else needs mounting — see [AI agent](ai.md#sables-isolated-agent-home-sable-libsable-workspacets).
- **Secrets.** The web service reads your `.env` (`env_file`) for `AUTH_SECRET`, AI keys,
  SMTP, etc. `DATABASE_URL`, `GOTENBERG_URL`, `UPLOAD_DIR`, `SERVIO_STATE_DIR` (release
  file) and `SCHEDULER_ENABLED` are set in the compose file and take precedence over `.env`.
- **Public origin.** `APP_URL` is also a build argument (`docker-compose.yml` forwards it):
  share-preview metadata on prerendered pages keeps the value the image was built with,
  which is `http://localhost:3000` for the published image. Links in mails and CSAT surveys
  read `APP_URL` at runtime (or **Settings › General**).

CI builds this image and boots it on every pull request (see [releasing.md](./releasing.md)).

### Self-update

`docker-compose.release.yml` runs the published images together with the **updater** sidecar, which lets admins schedule updates from Settings › Updates. The updater runs unprivileged and without a network, reaches Docker only through a filtering socket proxy's private unix socket (set `DOCKER_GID` in `.env`), shares `/data` with `web` and keeps its backups on its own volume; see [updates.md](./updates.md) for setup, security and rollback behaviour. `SERVIO_STATE_DIR` defaults to `/data/state` in the image.

### Published images and tags

Every release publishes multi-arch (`linux/amd64`, `linux/arm64`) images to GHCR:
`ghcr.io/jonax1337/servio` and `ghcr.io/jonax1337/servio-updater`, each tagged `X.Y.Z`,
`X.Y` and `latest` (stable releases only; see [releasing.md](./releasing.md)). Pin
`SERVIO_VERSION=X.Y.Z` in production if you want `docker compose up` to be reproducible.
To run a published image with the source compose file instead, replace the `build:` block
of the `web` service with `image: ghcr.io/jonax1337/servio:X.Y.Z`.

---

## 🗄️ Database: SQLite → PostgreSQL

Servio ships with **SQLite**, which is also what the published Docker image uses. The
same Prisma schema targets PostgreSQL with a provider change — no model changes are
needed — but that means building from source (or your own image).

> **Why the schema is portable.** SQLite has no native enums, so `status`, `priority`,
> `type`, `role`, etc. are `String` columns backed by the constants in
> [`lib/constants.ts`](../lib/constants.ts) and validated with Zod. Those `String`
> columns work unchanged on PostgreSQL. See the note at the top of
> [`prisma/schema.prisma`](../prisma/schema.prisma).

### 1. Change the datasource provider

Edit the `datasource` block in [`prisma/schema.prisma`](../prisma/schema.prisma):

```prisma
datasource db {
  provider = "postgresql"   // was: "sqlite"
  url      = env("DATABASE_URL")
}
```

### 2. Point `DATABASE_URL` at PostgreSQL

```bash
DATABASE_URL="postgresql://servio:strong-password@db-host:5432/servio?schema=public&sslmode=require"
```

(Local dev uses `DATABASE_URL="file:./dev.db"`.)

### 3. Apply migrations and seed

The repo defines a single production-oriented setup script in
[`package.json`](../package.json):

```jsonc
"scripts": {
  "setup": "prisma migrate deploy && prisma db seed",
  // ...
}
```

```bash
pnpm setup
```

- `prisma migrate deploy` applies committed migrations non-interactively — the correct
  command for production (unlike `prisma migrate dev`, which is a dev-only command that
  can generate new migrations).
- `prisma db seed` then runs the seed defined under the `prisma.seed` key:
  `tsx prisma/seed.ts && tsx prisma/seed-extras.ts`. This creates the initial admin
  user and demo/reference data. Note that **tsx is a devDependency** — on a lean
  production box without devDependencies installed, install them or run the seed
  through `npx tsx prisma/seed.ts && npx tsx prisma/seed-extras.ts`.

> **Seeding is optional and one-time.** On an existing production database you usually
> want migrations only. Run `pnpm exec prisma migrate deploy` on its own for subsequent
> deploys, and reserve `pnpm setup` (which also seeds) for first-time provisioning.

> **Regenerating the client.** `pnpm build` does **not** run `prisma generate`; the client
> is generated by `@prisma/client`'s install step or explicitly with `pnpm db:generate`
> (the Dockerfile runs `prisma generate` before `pnpm build`). After changing the provider,
> run `pnpm db:generate` so the client targets **postgresql**.

> **The committed migrations are SQLite migrations.** `prisma/migrations/migration_lock.toml`
> records `provider = "sqlite"` and the SQL is SQLite-flavoured, so `prisma migrate deploy`
> will not apply them to PostgreSQL. For a fresh PostgreSQL database, create your own
> baseline migration from the schema (for example with
> `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`)
> or use `prisma db push`, then seed with `prisma db seed`.

---

## 🔐 Required production environment

With Docker, put these in the `.env` next to the compose file; from source, copy
[`.env.example`](../.env.example) to `.env` (or set real environment variables in your
platform). Set at minimum:

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | From source | SQLite `file:` URL or PostgreSQL connection string (see above). The Docker compose files set it for you. |
| `AUTH_SECRET` | Yes | Strong random secret used to sign JWT sessions. Generate with `npx auth secret` or `openssl rand -base64 32`. **Never** reuse the dev value. |
| `SETTINGS_ENCRYPTION_KEY` | Recommended | 32-byte key (base64 or hex) that encrypts secrets stored in **Settings**. Without it, secret fields (SMTP password, AI keys, sync credentials, MCP headers) cannot be saved. |
| `AUTH_URL` (or legacy `NEXTAUTH_URL`) | Behind a domain | Public origin, e.g. `https://servicedesk.example.com`, for OIDC callbacks and redirects. Host headers are trusted (`trustHost: true` in [`auth.config.ts`](../auth.config.ts)), so `AUTH_TRUST_HOST` is not needed. |
| `APP_URL` | Behind a domain | Public origin for links in mails and CSAT surveys and for share-image metadata. Set to the same value as `AUTH_URL`; it can also be changed in **Settings › General**. |
| `APP_NAME` | No | Display name (defaults to `Servio`). |

### SSO / OIDC (optional)

OIDC is **only registered when configured** — see
[`auth.ts`](../auth.ts), which guards on `AUTH_OIDC_ID && AUTH_OIDC_ISSUER`. Leave these
empty to hide the SSO button.

| Variable | Notes |
| --- | --- |
| `AUTH_OIDC_ID` | OIDC client ID. |
| `AUTH_OIDC_SECRET` | OIDC client secret. |
| `AUTH_OIDC_ISSUER` | Issuer URL (Keycloak, Authentik, Azure AD, Okta, Google, …). |
| `AUTH_OIDC_NAME` | Button label (defaults to `SSO`). |

### Email / SMTP (optional)

Mail is pluggable. If `SMTP_HOST` **and** `SMTP_PORT` are set, messages are delivered via
nodemailer; otherwise Servio runs in **outbox mode** — every message is still recorded in
the `EmailMessage` table and viewable in **Settings › Mail Log**, but nothing is
delivered. SMTP and inbound IMAP can also be configured in **Settings › Email** and
**Settings › Inbound** instead of `.env`.
See [`lib/mail.ts`](../lib/mail.ts).

| Variable | Notes |
| --- | --- |
| `SMTP_HOST` | Empty ⇒ outbox mode (no real delivery). |
| `SMTP_PORT` | Defaults to `587`. |
| `SMTP_SECURE` | `true` for implicit TLS (port 465). |
| `SMTP_USER` / `SMTP_PASS` | Auth credentials. |
| `SMTP_FROM` | From header, e.g. `Servio Service Desk <servio@example.com>`. |

> **Edge runtime note.** The middleware ([`proxy.ts`](../proxy.ts)) runs the Edge-safe
> auth config from [`auth.config.ts`](../auth.config.ts), which contains **no Prisma or
> bcrypt** so it can run in the middleware runtime. The heavy providers (Credentials,
> OIDC) live in [`auth.ts`](../auth.ts) on the Node runtime. Do not add DB/crypto imports
> to `auth.config.ts` or the middleware build will break.

---

## 🏗️ Build & run

From source, on Node 24 with pnpm 11 (see [development.md](./development.md#prerequisites)):

```bash
pnpm install
pnpm setup      # first deploy only: migrate deploy + seed
pnpm build      # next build (Turbopack)
pnpm start      # next start — serves the production build
```

The scripts map directly to Next.js 16:

| Script | Command | Purpose |
| --- | --- | --- |
| `pnpm build` | `brand:check && next build` | Validate brand assets, then produce the optimized production build. |
| `pnpm start` | `next start` | Run the production server (default port 3000; override with `-p` or `PORT`). |

[`next.config.ts`](../next.config.ts) only sets security headers, `poweredByHeader: false`
and keeps `@anthropic-ai/claude-agent-sdk` out of the bundle (`serverExternalPackages`).
There is no `output: "standalone"` or custom runtime configured, so deploy it like a
standard `next start` app. Node runtime is required — the app uses `node:fs`/`node:crypto`
for storage and spawns the Claude Code CLI for Sable.

> ### ⚠️ Run a single app instance (the scheduler is not multi-instance safe)
>
> Servio is designed to run as a **single instance**. The background scheduler
> ([`lib/scheduler.ts`](../lib/scheduler.ts)) is an in-process `setInterval` loop that starts
> in **every** server process (unless `SCHEDULER_ENABLED=false`, see below) and whose
> idempotency is **in-memory only**. If you run two or more
> app instances (horizontal scaling, blue/green with overlap, a hot standby that also serves),
> **each replica independently fires the same background work**:
>
> - **SLA escalation double-fires.** The AT_RISK "already notified" guard is a per-process
>   `Set` (`sla-escalation.ts` `atRiskFired`), and breach escalation has no durable marker, so
>   every replica escalates/notifies the same tickets → duplicate escalations and alert spam.
> - **Inbound mail is polled by every replica.** Each instance runs its own IMAP poll, so
>   messages can be processed more than once (dedupe is best-effort per process).
> - **Scheduled syncs run on every replica** → duplicate `SyncRun` rows (imports are
>   idempotent, so imported *data* stays correct, but the runs are duplicated).
>
> Until an external scheduler / durable at-most-once locking is added, **scale vertically, or
> designate exactly one instance as the scheduler/worker** and disable the loop elsewhere:
> the designated instance keeps `SCHEDULER_ENABLED=true` (the default) and every other
> replica sets **`SCHEDULER_ENABLED=false`**, which skips all background ticks entirely.
> Timers are also cleared on SIGTERM/SIGINT (`stopScheduler`, wired in
> [`instrumentation.ts`](../instrumentation.ts)) so a rolling deploy never fires ticks
> mid-shutdown. See [Scheduled syncs](#-scheduled-syncs) below.

---

## 📁 Persistent file storage

Attachments are stored via a pluggable storage adapter in
[`lib/storage.ts`](../lib/storage.ts). Only the **filesystem driver is implemented**; the
`s3` and `vercel-blob` drivers are **seams** (commented-out `case` branches), not working
code.

| `STORAGE_DRIVER` | Status |
| --- | --- |
| `fs` (default) | **Implemented.** Stores blobs on the local filesystem. |
| `s3` | **Seam only** — not implemented. Selecting it throws at startup. |
| `vercel-blob` | **Seam only** — not implemented. Selecting it throws at startup. |

```ts
// lib/storage.ts — createAdapter()
switch (driver) {
  case "fs":
    return new FilesystemAdapter(process.env.UPLOAD_DIR ?? "./.uploads");
  // Seams for production drivers — implement and return here:
  // case "s3": return new S3Adapter(...);
  // case "vercel-blob": return new VercelBlobAdapter(...);
  default:
    throw new Error(`Unsupported STORAGE_DRIVER: ${driver}`);
}
```

Any value other than `fs` throws `Unsupported STORAGE_DRIVER`, so **use `fs` in production
until an object-storage adapter is implemented.**

### Requirements for the `fs` driver in production

- **`UPLOAD_DIR` must point at a persistent volume** — a mounted disk that survives
  restarts and redeploys. Ephemeral/container-local filesystems will lose attachments.
- **Keep `UPLOAD_DIR` outside `./public`.** The default `./.uploads` is git-ignored and
  intentionally outside `public/`: blobs must never be served statically. Every read is
  proxied through an authorized route, and the storage keys are unguessable
  (`YYYY/MM/<uuid>-<safeName>`, see `buildStorageKey`).
- `MAX_UPLOAD_MB` (default `15`) caps per-file size; `lib/files.ts` derives the byte limit.

> **Platform implication.** Because the only working driver is local-filesystem, Servio is
> best deployed on a host with a persistent disk (VM, Docker with a volume, Fly.io volume,
> etc.). A fully stateless/serverless target (e.g. Vercel functions) needs an object-store
> adapter implemented first.

---

## ⏰ Scheduled syncs

Servio's sync engine (`SyncSource` in [`prisma/schema.prisma`](../prisma/schema.prisma))
runs on an **in-process scheduler** started at server boot from
[`instrumentation.ts`](../instrumentation.ts) → [`lib/instrumentation-node.ts`](../lib/instrumentation-node.ts) → [`lib/scheduler.ts`](../lib/scheduler.ts)
(Node runtime only, HMR-guarded; the Node-only body — `process.on` signal handlers —
lives in `lib/instrumentation-node.ts` so `instrumentation.ts` itself stays free of
Node-only APIs Turbopack would otherwise flag against the Edge runtime bundle). The
same scheduler runs the inbound-mail poll and a
`syncTick` that fires any active source whose `schedule` (cron) is due.

- Cron is parsed with `cron-parser`; a source is due when its next occurrence after
  `lastRunAt` has passed (`isSyncDue`). A never-run scheduled source fires once, then
  advances. Invalid cron never fires.
- Tick cadence: the `SYNC_TICK_SECONDS` setting (default `60`, min `30`) — independent of
  the IMAP poll interval. Manual **Run now** from the UI (`runSync`) still works.
- Runs execute via the session-less `executeSyncRun` ([`lib/sync-runner.ts`](../lib/sync-runner.ts)),
  shared by manual and scheduled runs, with a per-source in-process lock so the two never
  overlap.

> **⚠️ Multi-instance caveat (applies to the whole scheduler, not just syncs).** The scheduler
> — the sync tick **and** the inbound-mail poll **and** the SLA escalation sweep — runs in
> *every* server instance by default, and its idempotency is in-memory only. If you scale
> horizontally, each replica independently fires all three: duplicate `SyncRun` rows (imports are
> idempotent, so data stays correct), re-polled inbound mail, and **double-fired SLA
> escalations/notifications** (the AT_RISK marker is a per-process `Set` and breach escalation has
> no durable marker). Run the scheduler on exactly one instance: keep the default
> **`SCHEDULER_ENABLED=true`** there and set **`SCHEDULER_ENABLED=false`** on every other replica
> (or add external locking). See the single-instance warning under [Build & run](#️-build--run).

There is no external cron dependency to provision.

---

## Checklist

**Docker (published images)**

- [ ] `.env` next to `docker-compose.release.yml` with `AUTH_SECRET`, `SETTINGS_ENCRYPTION_KEY` and `DOCKER_GID`.
- [ ] `APP_URL` and `AUTH_URL` set to the public HTTPS origin; TLS terminated by a reverse proxy.
- [ ] Seeded demo passwords changed and the demo API token revoked after the first login.
- [ ] The `servio-data` (database + uploads) and `servio-backups` volumes are part of your backups.
- [ ] Exactly one instance runs the scheduler (`SCHEDULER_ENABLED`).

**From source**

- [ ] For PostgreSQL: datasource provider changed, `pnpm db:generate` run, PostgreSQL baseline created.
- [ ] `DATABASE_URL` points at the database.
- [ ] First deploy migrated and seeded (`pnpm setup` on SQLite); later deploys `prisma migrate deploy`.
- [ ] Strong `AUTH_SECRET` and `SETTINGS_ENCRYPTION_KEY` generated.
- [ ] `AUTH_URL` and `APP_URL` set to the public HTTPS origin.
- [ ] OIDC and/or SMTP configured if used (otherwise SSO hidden / mail in outbox mode).
- [ ] `STORAGE_DRIVER=fs` with `UPLOAD_DIR` on a persistent volume outside `public/`.
- [ ] `pnpm build && pnpm start` behind TLS/reverse proxy.

See [configuration.md](./configuration.md) for the complete environment reference.
