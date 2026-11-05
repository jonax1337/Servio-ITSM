# Deployment

Production deployment guide for Servio. This covers moving the database from SQLite to
PostgreSQL, the required production environment, building and running the app, persistent
file storage, and how scheduled syncs run.

For the full list of environment variables and their meaning, see
[configuration.md](./configuration.md). For the schema itself, see
[data-model.md](./data-model.md).

Application builds validate committed brand assets before Next.js runs. Keep
the canonical `branding` sources and synced `public/brand` / `app` files in
the build context. Local Manrope is compiled from `branding/fonts` into Next's
static font output. Normal deployment does not require the Python/browser
tools used to author the full brand kit. See [branding.md](./branding.md).

---

## 🗄️ Database: SQLite → PostgreSQL

Servio ships with **SQLite** for local development. The same Prisma schema targets
PostgreSQL in production with a one-line provider change — no model changes are needed.

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

> **Regenerating the client.** `prisma generate` runs as part of `pnpm build` via the
> Next build, but if you deploy prebuilt artifacts make sure the Prisma client was
> generated against the **postgresql** provider (i.e. after step 1). Changing the
> provider requires a fresh `prisma generate`.

---

## 🔐 Required production environment

Copy [`.env.example`](../.env.example) to `.env` (or set real environment variables in
your platform) and set at minimum:

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string (see above). |
| `AUTH_SECRET` | Yes | Strong random secret used to sign JWT sessions. Generate with `npx auth secret`. **Never** reuse the dev value. |
| `AUTH_TRUST_HOST` | Yes | Set `true` when running behind a proxy/load balancer so Auth.js trusts the host header. |
| `NEXTAUTH_URL` | Yes | Public origin, e.g. `https://servicedesk.example.com`. Must match the deployed URL for callback/redirect correctness. |
| `APP_URL` | Yes | Public origin for links and build-time share-image metadata. Set to the same value as `NEXTAUTH_URL`; Compose forwards it to the image build. Rebuild if that origin changes. |
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
the `EmailMessage` table and viewable under **Settings › Mail**, but nothing is delivered.
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

```bash
pnpm install
pnpm setup      # first deploy only: migrate deploy + seed
pnpm build      # next build (Turbopack)
pnpm start      # next start — serves the production build
```

The scripts map directly to Next.js 16:

| Script | Command | Purpose |
| --- | --- | --- |
| `pnpm build` | `next build` | Produce the optimized production build. |
| `pnpm start` | `next start` | Run the production server (default port 3000; override with `-p` or `PORT`). |

Servio has **no custom `next.config.ts` options** — [`next.config.ts`](../next.config.ts)
is the default export. There is no `output: "standalone"` or custom runtime configured, so
deploy it like a standard `next start` app (or on a platform that supports the Next.js 16
App Router). Node runtime is required — the app uses `node:fs`/`node:crypto` for storage.

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

## 🐳 Docker

A [`Dockerfile`](../Dockerfile) and [`docker-compose.yml`](../docker-compose.yml) are
provided. The compose stack runs the app plus **Gotenberg** (LibreOffice) for
high-fidelity office-document previews.

```bash
# Just Gotenberg (use it alongside local `next dev`):
docker compose up -d gotenberg          # publishes host :3001 → set GOTENBERG_URL=http://localhost:3001

# The whole stack (app + Gotenberg):
docker compose up --build               # app on :3000, Gotenberg internal
```

- **Database.** The compose stack defaults to **SQLite on the `/data` volume**
  (`DATABASE_URL=file:/data/servio.db`, set in `docker-compose.yml`; the image
  itself ships **no baked-in DATABASE_URL**). Servio's Prisma schema currently targets
  SQLite. To run Postgres instead, switch `datasource.provider` to `postgresql` in
  [`prisma/schema.prisma`](../prisma/schema.prisma), migrate, then uncomment the `db`
  service in the compose file and repoint `DATABASE_URL`.
- **Uploads.** Blob storage is redirected to `/data/uploads` (same volume) via
  `UPLOAD_DIR`, so DB + files persist together.
- **Boot.** [`docker/entrypoint.sh`](../docker/entrypoint.sh) runs `prisma migrate deploy`
  (the committed baseline migration is kept current) and seeds once per volume,
  then starts Next via `pnpm start`. Migration failures abort boot (`set -e`).
- **Health.** The image defines a `HEALTHCHECK` (GET `/login`) and the compose file adds
  matching healthchecks for `web` and `gotenberg`; `web` waits for Gotenberg's `/health`
  before starting.
- **Scheduler.** The container defaults to `SCHEDULER_ENABLED=true`. If you run more than
  one replica of this stack, set `SCHEDULER_ENABLED=false` on all but one — see the
  single-instance warning above.
- **Office previews.** The web service sets `GOTENBERG_URL=http://gotenberg:3000`
  automatically. Documents (docx/pptx/legacy/ODF) then render as a faithful PDF in the
  lightbox; without it, Servio falls back to a best-effort text/HTML preview.
- **Secrets.** The web service reads your `.env` (`env_file`) for `AUTH_SECRET`, AI keys,
  SMTP, etc. — override `DATABASE_URL`/`GOTENBERG_URL`/`UPLOAD_DIR` are set in the compose.

> The `Dockerfile`/compose were authored for this project but should be **test-built in
> your environment** (`docker compose build`) before a real deploy. Gotenberg office
> conversion itself is verified working end-to-end.

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
> (or add external locking). See the single-instance warning under [Build & run](#-build--run).

There is no external cron dependency to provision.

---

## Checklist

- [ ] `prisma/schema.prisma` datasource provider changed to `postgresql`.
- [ ] `DATABASE_URL` points at PostgreSQL.
- [ ] `pnpm setup` run once (migrate + seed), or `prisma migrate deploy` for later deploys.
- [ ] Strong `AUTH_SECRET` generated (`npx auth secret`), `AUTH_TRUST_HOST=true`.
- [ ] `NEXTAUTH_URL` and `APP_URL` set to the public HTTPS origin.
- [ ] OIDC and/or SMTP configured if used (otherwise SSO hidden / mail in outbox mode).
- [ ] `STORAGE_DRIVER=fs` with `UPLOAD_DIR` on a persistent volume outside `public/`.
- [ ] `pnpm build && pnpm start` behind TLS/reverse proxy.

See [configuration.md](./configuration.md) for the complete environment reference.
