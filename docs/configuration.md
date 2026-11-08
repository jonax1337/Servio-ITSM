# ⚙️ Configuration

This is the environment and configuration reference for Servio. Runtime
configuration is supplied through environment variables — there is no separate
config file — and a subset can be overridden by an admin in the UI (see the callout
below). Where you set them depends on how you run Servio:

- **Docker (primary install path):** put them in a `.env` file **next to the compose
  file** (`docker-compose.release.yml` for the prebuilt GHCR images, or
  `docker-compose.yml` for a local build). The `web` service loads it with
  `env_file: .env`. Variables listed under `environment:` in the compose file
  (`DATABASE_URL`, `UPLOAD_DIR`, `GOTENBERG_URL`, `SCHEDULER_ENABLED`, and
  `SERVIO_STATE_DIR` in the release file) take precedence over `.env`.
  Compose-level variables such as `SERVIO_VERSION` and `DOCKER_GID` also come from
  this `.env` — see [Docker, compose and updater variables](#docker-compose-and-updater-variables).
- **Local development:** copy [`../.env.example`](../.env.example) to `.env` in the
  repo root and edit it.

Servio is designed to run with **zero required setup for local development**:
with a fresh checkout you only need `DATABASE_URL` and `AUTH_SECRET`. Every
integration (SSO, SMTP, inbound mail, AI/Sable, non-local storage) is optional and
degrades gracefully when left unconfigured.

See also: [development.md](development.md) for the local dev loop, and
[deployment.md](deployment.md) for hardening these values in production.

> **Admin Settings override `.env`.** Most application-level config can be managed
> from the UI under **Settings** (ADMIN only) and is stored in the `AppSetting`
> table: **General** (`APP_NAME`, `APP_URL`), **Email** (`SMTP_*`), **Inbound**
> (`IMAP_*`, `MAIL_PLUS_ADDRESSING`), **Sable (AI assistant)** (provider, model, keys,
> web search, teaser, triage), **Uploads** (`MAX_UPLOAD_MB`, `GOTENBERG_URL`) and
> **Updates** (`UPDATE_*`). Precedence for every key is **DB row (non-empty) →
> `process.env` (non-empty) → built-in default**, so an empty table falls back to
> `.env` and nothing breaks until an admin overrides a value; saving an empty
> value deletes the override. Secrets (SMTP password, IMAP password, AI API keys,
> Claude Code token, web-search keys) are encrypted at rest (AES-256-GCM) using
> `SETTINGS_ENCRYPTION_KEY` (base64 or hex, 32 bytes); without a valid key the UI
> refuses to store a secret, and a stored secret that can no longer be decrypted
> (for example after a key rotation) falls back to the `.env` value. Resolution
> lives in [`../lib/settings.ts`](../lib/settings.ts) + [`../lib/crypto.ts`](../lib/crypto.ts),
> and the Settings forms in [`../lib/actions/settings.ts`](../lib/actions/settings.ts).
> Several background-task variables (the `*_TICK_SECONDS`, `INSIGHT*`, `SLA_NUDGE*`,
> `CONTRACT*`, `CHANGE_CONFLICT_SAME_SERVICE`, `IMAP_TLS_REJECT_UNAUTHORIZED`) go
> through the same resolver but have no Settings field. Everything else is read
> straight from `process.env` and can only be set there: bootstrap secrets
> (`DATABASE_URL`, `AUTH_SECRET`, `SETTINGS_ENCRYPTION_KEY`), OIDC/SSO, storage,
> rate limits, CORS, `SCHEDULER_ENABLED`, `SERVIO_STATE_DIR` and `SABLE_HOME`.

---

## Environment variable reference

The table below is derived from [`../.env.example`](../.env.example), a grep of
every `process.env.*` read in the codebase, and every key read through
`getSetting` / `getBoolSetting` / `getNumberSetting` in `lib/settings.ts`.
Variables marked _(not in `.env.example`)_ are real but missing from the sample
file. The sample file is a starting point, not the full list.

| Variable | Required? | Default | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` | **Yes** | — | Prisma connection string. Consumed via `env("DATABASE_URL")` in [`../prisma/schema.prisma`](../prisma/schema.prisma). Default provider is `sqlite` (`file:./dev.db`; the compose files set `file:/data/servio.db`); swap the datasource `provider` to `postgresql` for production. |
| `AUTH_SECRET` | **Yes** | — | Secret used by Auth.js to sign/encrypt the JWT session. Read implicitly by `next-auth`. See [generating `AUTH_SECRET`](#generating-auth_secret). |
| `AUTH_TRUST_HOST` | No | — | Not needed: [`../auth.config.ts`](../auth.config.ts) hard-codes `trustHost: true`, so the host header is trusted (also behind a reverse proxy). Harmless if set. |
| `NEXTAUTH_URL` | No | — | Canonical app URL for Auth.js callback/redirect resolution when host inference is undesirable. Also the last fallback (after `APP_URL` and `AUTH_URL`, then `http://localhost:3000`) for the page metadata base URL in [`../app/layout.tsx`](../app/layout.tsx). `.env.example` sets `http://localhost:3000`. |
| `AUTH_URL` _(not in `.env.example`)_ | No | — | Auth.js' own name for the canonical URL. Read by `next-auth` and as the second fallback for the page metadata base URL (`APP_URL` → `AUTH_URL` → `NEXTAUTH_URL`) in [`../app/layout.tsx`](../app/layout.tsx). |
| `AUTH_OIDC_ID` | No | — | OIDC/OAuth **client ID**. Presence of this **and** `AUTH_OIDC_ISSUER` enables SSO. See [SSO / OIDC setup](#sso--oidc-setup). |
| `AUTH_OIDC_SECRET` | No | — | OIDC client secret. Passed to the provider; not part of the enable gate. |
| `AUTH_OIDC_ISSUER` | No | — | OIDC issuer URL (the IdP's discovery base, e.g. `https://idp/realms/main`). Required to enable SSO. |
| `AUTH_OIDC_NAME` | No | `SSO` | Display name for the SSO button ("Continue with _{name}_"). |
| `AUTH_OIDC_ROLE_MAP` | No | — | Map IdP groups/roles to Servio roles, e.g. `it-admins=ADMIN,service-desk=AGENT`. Unset = roles are managed in Servio only. See [Role mapping](#role-mapping-from-the-idp). |
| `AUTH_OIDC_ROLES_CLAIM` | No | `groups` | Claim holding the groups/roles; dot paths allowed (`realm_access.roles`). |
| `AUTH_OIDC_DEFAULT_ROLE` | No | `USER` | Role when the claim is present but no entry matches. |
| `AUTH_OIDC_ROLE_SYNC` | No | `login` | `login` = re-apply the mapping on every SSO sign-in (IdP is the source of truth); `signup` = only on the first sign-in. |
| `APP_NAME` | No | `Servio` | Application display name used in outgoing mail and in Sable's context. Overridable in Settings › General. |
| `APP_URL` | No | _empty_ | Public origin for absolute mail/CSAT links and build-time social image URLs. Overridable in Settings › General, which wins for runtime mail/survey links; static share metadata uses the build environment and requires a rebuild when the origin changes. `docker-compose.yml` forwards this value as a build argument (the Dockerfile `APP_URL` arg defaults to `http://localhost:3000`). |
| `SMTP_HOST` | No | _empty_ | SMTP server host. **Leaving it empty enables outbox mode** — see [Email / SMTP](#email--smtp). Overridable in Settings › Email (as are the other `SMTP_*`). |
| `SMTP_PORT` | No | `587` | SMTP port. Together with `SMTP_HOST` it forms the "SMTP configured" check in [`../lib/mail.ts`](../lib/mail.ts): both must resolve to a non-empty value (the `587` fallback applies only when sending). |
| `SMTP_SECURE` | No | `false` | `"true"` to use an implicit TLS connection (typically port 465); any other value uses STARTTLS. |
| `SMTP_USER` | No | — | SMTP auth username. If empty, the transport connects **without** auth. |
| `SMTP_PASS` | No | — | SMTP auth password (only used when `SMTP_USER` is set). Secret — encrypted at rest when set via Settings. |
| `SMTP_FROM` | No | `Servio <servio@localhost>` (`.env.example`) | Envelope/`From` header for outgoing mail. |
| `IMAP_ENABLED` _(not in `.env.example`)_ | No | `false` | Turn on the inbound-mail poll (needs `IMAP_HOST`, `IMAP_USER` and `IMAP_PASS`, otherwise nothing is polled). Read by [`../lib/scheduler.ts`](../lib/scheduler.ts); Settings › Inbound. |
| `IMAP_HOST` _(not in `.env.example`)_ | No | — | IMAP server host. |
| `IMAP_PORT` _(not in `.env.example`)_ | No | `993` | IMAP port. |
| `IMAP_SECURE` _(not in `.env.example`)_ | No | `true` | Use implicit TLS for the IMAP connection. |
| `IMAP_USER` _(not in `.env.example`)_ | No | — | IMAP login. |
| `IMAP_PASS` _(not in `.env.example`)_ | No | — | IMAP password. Secret — encrypted at rest when set via Settings. |
| `IMAP_FOLDER` _(not in `.env.example`)_ | No | `INBOX` | Mailbox folder to poll. |
| `IMAP_POLL_SECONDS` _(not in `.env.example`)_ | No | `60` | Inbound poll interval (floor 15). |
| `IMAP_TLS_REJECT_UNAUTHORIZED` _(not in `.env.example`)_ | No | `true` | Set `false` to accept a self-signed IMAP certificate. No Settings field. |
| `MAIL_PLUS_ADDRESSING` _(not in `.env.example`)_ | No | `false` | The Settings › Inbound switch "Match on plus-addressing (support+INC-123@…)". |
| `STORAGE_DRIVER` | No | `fs` | Blob storage driver. Only `fs` is implemented; `s3` and `vercel-blob` are seams in [`../lib/storage.ts`](../lib/storage.ts). An unknown value throws at startup. |
| `UPLOAD_DIR` | No | `./.uploads` | Filesystem root for the `fs` driver. **Must stay outside `./public`** — see [File storage](#file-storage--attachments). |
| `MAX_UPLOAD_MB` | No | `15` | Per-file upload cap in MB. The upload route enforces the Settings › Uploads value (falling back to the env value); [`../lib/files.ts`](../lib/files.ts) derives the client-side mirror `MAX_UPLOAD_BYTES` from the env value only. |
| `PROXY_MAX_BODY_MB` | No (**build time**) | `32` | How much of a request body Next.js buffers for `proxy.ts` (`experimental.proxyClientMaxBodySize` in [`../next.config.ts`](../next.config.ts)). Must exceed the upload cap plus multipart overhead, or larger uploads fail. Baked into the build: the published image uses 32 MB, so an upload cap above ~31 MB needs a source build with a higher value. |
| `AI_PROVIDER` | No | `anthropic` | Sable's AI backend: `anthropic` \| `openai` \| `ollama` \| `claude-code`. See [AI service agent (Sable)](#ai-service-agent-sable). |
| `AI_ALLOW_EXTERNAL` | No | `false` | **Privacy gate.** Must be exactly `"true"` to allow an external provider (`anthropic`/`openai`); `ollama`/`claude-code` are not gated. |
| `AI_MODEL` | No | provider default | Explicit model id. Blank falls back to `claude-sonnet-5` / `gpt-4o` / `$OLLAMA_MODEL` / `sonnet` (claude-code). |
| `AI_MAX_OUTPUT_TOKENS` | No | blank (Auto) | Cap on AI output tokens per call. Blank / `auto` / `0` uses the model's own limit (proxied OpenAI-compatible models learn their cap from the upstream's error); a number is raised to at least 8192 (thinking shares the budget). |
| `CLAUDE_CODE_OAUTH_TOKEN` | For `claude-code` | — | Long-lived Claude subscription token from `claude setup-token` (Sable's isolated instance can't use an interactive login); without it `claude-code` counts as not configured. Encrypted when set in the UI. |
| `SABLE_HOME` | No | `~/.servio/sable` | Sable's isolated agent home: its own Claude config dir (charter + built-in ITSM skills from `sable/` plus custom skills managed in Settings › Sable) and an empty working dir. |
| `AI_TEASER` | No | `false` | When AI is **off**, still show the AI buttons as a disabled preview (a "ask your admin" nudge). |
| `AI_TICKET_TRIAGE` | No | `true` | Show Sable's inline triage suggestions (priority/type/team/category) when an agent opens a ticket. Turn off to hide them; chat and request handling stay on. |
| `ANTHROPIC_API_KEY` | No | — | Anthropic key. Secret — encrypted at rest when set via Settings. Only used when `AI_PROVIDER=anthropic` **and** the gate is open. |
| `OPENAI_API_KEY` | No | — | OpenAI (compatible) key. Secret. Only used when `AI_PROVIDER=openai` **and** the gate is open. |
| `OPENAI_BASE_URL` | No | — | Override the OpenAI endpoint to reach any OpenAI-compatible cloud (OpenAI, OpenRouter, Moonshot/Kimi, Zhipu/GLM…). No Settings field. |
| `OLLAMA_BASE_URL` | No | `http://localhost:11434/v1` | Local Ollama endpoint (OpenAI-compatible). No key required. |
| `OLLAMA_MODEL` | No | `llama3.1` | Local Ollama model id. |
| `WEB_SEARCH_PROVIDER` | No | `auto` | Backend for Sable's `web_search` tool: `tavily` \| `brave` \| `duckduckgo` \| `auto`. `auto` uses a configured key (Tavily → Brave) else the keyless DuckDuckGo scraper. |
| `TAVILY_API_KEY` | No | — | [Tavily](https://app.tavily.com) key (LLM-oriented search, clean results; free tier ~1k/mo). Secret. |
| `BRAVE_API_KEY` | No | — | [Brave Search](https://brave.com/search/api) key (independent web index; free tier ~2k/mo). Secret. |
| `GOTENBERG_URL` _(not in `.env.example`)_ | No | — | Optional [Gotenberg](https://gotenberg.dev) (LibreOffice) service, e.g. `http://gotenberg:3000` (the compose files set it for the bundled `gotenberg` service). When set, office docs (docx/pptx/legacy/ODF) preview as a faithful PDF; blank = built-in best-effort text/HTML. Overridable in Settings › Uploads. See [deployment.md](deployment.md#-docker). |
| `SETTINGS_ENCRYPTION_KEY` | Recommended | — | 32-byte key (base64/hex) that encrypts secret settings (SMTP/IMAP passwords, AI and web-search keys, Claude Code token) stored in the DB. Bootstrap secret — `.env`-only. |
| `API_CORS_ORIGIN` | No | _unset ⇒ no CORS header_ | Allowed origin for the bearer-token REST API responses. Default-**closed**: when unset no `Access-Control-Allow-Origin` is emitted, so browsers treat the API as same-origin-only (curl/server clients unaffected). Read in [`../lib/api.ts`](../lib/api.ts). See [rest-api.md](rest-api.md). |
| `API_RATE_LIMIT` | No | `120` | Max REST API requests per token (falling back to client IP) per window. Read in [`../lib/rate-limit.ts`](../lib/rate-limit.ts); in-memory, per-process — see the multi-instance caveat in [deployment.md](deployment.md). |
| `API_RATE_WINDOW_MS` | No | `60000` | Sliding-window length (ms) for `API_RATE_LIMIT`. |
| `AI_RATE_LIMIT` | No | `20` | Max AI-endpoint requests (console + portal chat, confirm-create, triage) per session user per window — every request drives a provider call. |
| `AI_RATE_WINDOW_MS` | No | `60000` | Sliding-window length (ms) for `AI_RATE_LIMIT`. |
| `REPLY_RATE_LIMIT` | No | `10` | Max portal ticket replies (form and Sable) per session user per window. |
| `UPLOAD_RATE_LIMIT` | No | `30` | Max file uploads per session user per window, applied to `USER`-role (portal) accounts only. |
| `WRITE_RATE_WINDOW_MS` | No | `60000` | Sliding-window length (ms) shared by `REPLY_RATE_LIMIT` and `UPLOAD_RATE_LIMIT`. |
| `LOGIN_FREE_ATTEMPTS` | No | `5` | Failed login attempts allowed before backoff kicks in ([`../lib/rate-limit.ts`](../lib/rate-limit.ts)). |
| `LOGIN_BASE_BACKOFF_MS` | No | `2000` | Base backoff delay (ms) after the free attempts are used; grows per subsequent failure. |
| `LOGIN_MAX_BACKOFF_MS` | No | `900000` | Cap (ms, 15 min) on the login backoff delay. |
| `LOGIN_DECAY_MS` | No | `900000` | Idle window (ms, 15 min) after which a login's failure count decays/resets. |
| `SCHEDULER_ENABLED` | No | `true` | Master switch for the in-process background scheduler (SLA escalation sweep, inbound-mail poll, scheduled syncs, and the insights, SLA-nudge, contracts, maintenance, update-check and recurring-tickets ticks), read by [`../lib/scheduler.ts`](../lib/scheduler.ts) via [`../instrumentation.ts`](../instrumentation.ts). Only a case-insensitive `false` disables it. Set `"false"` on every replica except the designated scheduler instance — see the multi-instance notes in [deployment.md](deployment.md). |
| `SYNC_TICK_SECONDS` _(not in `.env.example`)_ | No | `60` | How often the scheduler looks for due scheduled syncs (floor 30). |
| `SLA_ESCALATION_TICK_SECONDS` _(not in `.env.example`)_ | No | `180` | Interval of the SLA escalation sweep (floor 60). |
| `INSIGHTS_ENABLED` _(not in `.env.example`)_ | No | `true` | Master switch for Sable's insight detection tick ([`../lib/ticks/ai-insights.ts`](../lib/ticks/ai-insights.ts)). Similarity is local lexical TF-IDF and needs no AI provider. |
| `INSIGHTS_TICK_SECONDS` | No | `900` | Interval of the insights tick (floor 300). |
| `INSIGHT_CLUSTER_MIN_TICKETS` | No | `3` | Similar tickets needed inside the window to raise an incident-cluster insight. |
| `INSIGHT_CLUSTER_WINDOW_HOURS` | No | `24` | Look-back window for incident clusters. |
| `INSIGHT_SIMILARITY_THRESHOLD` | No | `0.35` | Minimum similarity (0 to 1) for two tickets to count as the same cluster. |
| `INSIGHT_KB_GAP_MIN_TICKETS` | No | `3` | Recurring tickets without a linked article needed to raise a knowledge-gap insight. |
| `INSIGHT_KB_GAP_WINDOW_DAYS` | No | `30` | Look-back window for knowledge gaps. |
| `SLA_NUDGE_ENABLED` | No | `true` | Notify the assignee once when a ticket's SLA reaches `SLA_NUDGE_PERCENT` ([`../lib/ticks/sla-nudges.ts`](../lib/ticks/sla-nudges.ts)). Notification type `SLA_NUDGE`. |
| `SLA_NUDGE_PERCENT` | No | `75` | SLA elapsed percentage that triggers the nudge (clamped to 1..100). |
| `SLA_NUDGE_TICK_SECONDS` | No | `180` | Interval of the nudge tick (floor 60). |
| `CONTRACT_REMINDERS_ENABLED` | No | `true` | Send contract renewal reminders and license over-allocation alerts ([`../lib/ticks/contracts.ts`](../lib/ticks/contracts.ts)). |
| `CONTRACTS_TICK_SECONDS` | No | `3600` | Interval of the contracts tick (floor 600). |
| `RECURRING_TICKETS_ENABLED` _(not in `.env.example`)_ | No | `true` | Create the tickets of recurring ticket schedules when their creation window opens ([`../lib/ticks/recurring-tickets.ts`](../lib/ticks/recurring-tickets.ts)). Off = schedules keep their state and catch up once (the latest missed occurrence) when it is turned back on. |
| `RECURRING_TICKETS_TICK_SECONDS` _(not in `.env.example`)_ | No | `300` | Interval of the recurring-tickets tick (floor 60): how late after its creation time a ticket may appear. |
| `CHANGE_CONFLICT_SAME_SERVICE` | No | `true` | Also flag changes whose windows overlap and that share a service (through their affected CIs), not only a CI. |
| `SERVIO_STATE_DIR` | No | `/data/state` in the Docker image, `./.servio-state` otherwise | Directory shared with the updater sidecar and read by `proxy.ts`: `maintenance.json` and `updater/*.json` ([`../lib/state-dir.ts`](../lib/state-dir.ts)). See [updates.md](./updates.md). |
| `UPDATE_CHECK_ENABLED` _(not in `.env.example`)_ | No | `true` | Check GitHub Releases for new versions and notify the admins ([`../lib/ticks/update-check.ts`](../lib/ticks/update-check.ts)). Also editable at Settings › Updates. |
| `UPDATE_REPOSITORY` | No | `jonax1337/Servio-ITSM` | GitHub `owner/name` whose releases are offered. |
| `UPDATE_INCLUDE_PRERELEASES` | No | `false` | Also offer pre-releases. |
| `UPDATE_CHECK_TICK_SECONDS` | No | `21600` | Interval of the update-check tick (floor 3600). |
| `MAINTENANCE_TICK_SECONDS` | No | `15` | Interval of the maintenance tick that starts and ends windows and follows the updater (floor 5). |
| `NEXT_PUBLIC_DEMO_MODE` | No | `false` | Set `"true"` to keep the pre-filled demo credentials (`admin@servio.dev` / `servio123`) and their hint on the login page ([`../app/login/login-form.tsx`](../app/login/login-form.tsx)) visible in production builds. They always show outside production and are hidden in production unless this is set. The login form is a client component, so Next inlines the value **at build time**. |
| `NODE_ENV` | No | — | Standard Node/Next env. Toggles Prisma query logging ([`../lib/db.ts`](../lib/db.ts)) and the HMR-safe singleton guards in `lib/db.ts` / `lib/storage.ts`. The Docker image sets `production`. |

> **Tip for agents:** the enable gates treat an empty string as unset (the settings
> resolver skips empty values, and plain `process.env.X && …` checks are falsy for
> `""`), so an empty value in `.env` is equivalent to the variable being unset for
> every optional feature here.

### Docker, compose and updater variables

These are read by the container entrypoint, the compose files or the updater
sidecar, not by the Next.js app. Set the compose-level ones in the `.env` next to
`docker-compose.release.yml`. The full updater list is in
[`../updater/README.md`](../updater/README.md); the operator guide is
[updates.md](./updates.md).

| Variable | Where | Default | Description |
| --- | --- | --- | --- |
| `SERVIO_VERSION` | compose | `latest` | Image tag for `ghcr.io/jonax1337/servio` and `servio-updater`. Keep it in sync with what the updater installed, or use `latest`. |
| `DOCKER_GID` | compose | — (**required**) | Group id of `/var/run/docker.sock` (`stat -c %g /var/run/docker.sock`); `docker compose` fails without it (the socket proxy's group). |
| `REGISTRY_AUTH` | compose → updater | _empty_ | Base64url Docker auth config for pulling from a private registry. |
| `ALLOW_UPDATE_WITHOUT_BACKUP` | compose → updater | `false` | Required to update a non-SQLite (Postgres) deployment; you then own the database backup. |
| `ALLOW_BIND_MOUNTS_FROM` | compose → updater | _empty_ | Comma-separated host directories `web` may bind-mount; must match the proxy's `-allowbindmountfrom`. |
| `ALLOW_UNKNOWN_MIGRATIONS` | web container | `false` | [`../docker/entrypoint.sh`](../docker/entrypoint.sh) refuses to start when the database holds migrations the image does not ship (a newer version migrated it); `true` starts anyway. |
| `SERVIO_IMAGE`, `SERVIO_CONTAINER`, `DB_FILE`, `BACKUP_DIR`, `BACKUP_KEEP`, `HEALTH_TIMEOUT_SECONDS`, `PULL_TIMEOUT_SECONDS`, `REQUEST_MAX_AGE_SECONDS`, `RETRY_COOLDOWN_SECONDS`, `ALLOW_DOWNGRADE`, `ALLOW_PRERELEASE`, `DOCKER_SOCKET`, `DOCKER_HOST`, `DOCKER_API_VERSION` | updater | see README | Updater configuration ([`../updater/config.mjs`](../updater/config.mjs)). The release compose file already sets `SERVIO_IMAGE`, `SERVIO_CONTAINER`, `SERVIO_STATE_DIR`, `DB_FILE`, `BACKUP_DIR` and `DOCKER_SOCKET`. |

Development tooling only (not application config): `CI` is read by
[`../playwright.config.ts`](../playwright.config.ts); `DOCS_STRICT=1` and
`SKIP_DOCS_CHECK=1` control the doc-drift commit check in
[`../scripts/check-doc-drift.mjs`](../scripts/check-doc-drift.mjs).

---

## Generating `AUTH_SECRET`

`AUTH_SECRET` signs the session JWT. Never commit it and use a distinct value
per environment. Generate one with the Auth.js CLI (writes to `.env` if present):

```bash
pnpm dlx auth secret
```

Or generate a raw value manually:

```bash
openssl rand -base64 33
```

Then set it in `.env` (in Docker, the `.env` next to the compose file):

```dotenv
AUTH_SECRET="<generated-value>"
```

The session strategy is JWT (`session: { strategy: "jwt" }` in
[`../auth.config.ts`](../auth.config.ts)), so rotating this value invalidates all
existing sessions.

---

## SSO / OIDC setup

Servio ships a first-party **Credentials** (email + password) provider that is
always enabled. An optional OIDC provider is registered **only when configured**,
so no dead SSO button appears on a stock install.

### How the enable gate works

In [`../auth.ts`](../auth.ts) the OIDC provider is pushed only when **both**
`AUTH_OIDC_ID` and `AUTH_OIDC_ISSUER` are set:

```ts
if (process.env.AUTH_OIDC_ID && process.env.AUTH_OIDC_ISSUER) {
  providers.push({
    id: "oidc",
    name: process.env.AUTH_OIDC_NAME || "SSO",
    type: "oidc",
    issuer: process.env.AUTH_OIDC_ISSUER,
    clientId: process.env.AUTH_OIDC_ID,
    clientSecret: process.env.AUTH_OIDC_SECRET,
    allowDangerousEmailAccountLinking: false,
  });
}

export const ssoEnabled = Boolean(
  process.env.AUTH_OIDC_ID && process.env.AUTH_OIDC_ISSUER,
);
```

The same `ssoEnabled` flag is passed into the login form
([`../app/login/page.tsx`](../app/login/page.tsx) →
[`../app/login/login-form.tsx`](../app/login/login-form.tsx)), which renders the
"Continue with _{name}_" button **only when `ssoEnabled` is true**. Leave the
`AUTH_OIDC_*` vars empty and the SSO button — and the whole OIDC provider — simply
does not exist.

Notes:

- Only `AUTH_OIDC_ID` **and** `AUTH_OIDC_ISSUER` gate SSO. `AUTH_OIDC_SECRET` is
  passed to the provider but is **not** part of the enable check (public/PKCE
  clients can leave it empty).
- `allowDangerousEmailAccountLinking: false`: an OIDC identity is only linked to an
  existing local account with the same email when the IdP asserts a **verified**
  email (Auth.js' default behaviour). A user who hits `OAuthAccountNotLinked` must
  verify the email at the IdP, or an admin links the account manually.
- Session role/id come from the JWT callbacks in
  [`../auth.config.ts`](../auth.config.ts); a first-time OIDC user gets the
  default `USER` role via the Prisma adapter — unless role mapping is configured.

### Role mapping from the IdP

Set `AUTH_OIDC_ROLE_MAP` to derive the Servio role from the IdP instead of
promoting every SSO user by hand. The logic is in
[`../lib/oidc-roles.ts`](../lib/oidc-roles.ts) and runs in the `jwt` callback in
[`../auth.ts`](../auth.ts), after the account was created or linked:

- The user gets the **highest** role any of their groups maps to. Group names
  are compared case-insensitively and without a leading `/` (Keycloak's group
  mapper emits full paths like `/it-admins` by default).
- Claim present, nothing matches: `AUTH_OIDC_DEFAULT_ROLE` (default `USER`).
  With `AUTH_OIDC_ROLE_SYNC=login` this **demotes** users who left the group on
  their next sign-in.
- Claim **missing**: the role is left unchanged and a warning is logged. A
  missing claim usually means the IdP mapper is not set up; it must not demote
  everyone.
- A role change is written to the audit log (`User`, "Role X -> Y from SSO claim").
- An invalid map (unknown role, entry without `=`) is logged at startup and
  turns mapping off; it never changes a role.
- Local (password) accounts are never touched.

Keycloak example: add a **Group Membership** mapper to the client (token claim
name `groups`, "Add to ID token" on), then
`AUTH_OIDC_ROLE_MAP="it-admins=ADMIN,service-desk=AGENT"`. For realm/client
roles instead of groups use `AUTH_OIDC_ROLES_CLAIM=realm_access.roles`.

### Worked example (generic OIDC provider)

Point Servio at any standards-compliant IdP (Keycloak, Authentik, Azure AD,
Okta, Google, etc.). Register a **Web / confidential** client at the IdP with the
redirect URI:

```
https://your-servio-host/api/auth/callback/oidc
```

Then set:

```dotenv
AUTH_OIDC_ID="servio-web"
AUTH_OIDC_SECRET="<client-secret-from-idp>"
AUTH_OIDC_ISSUER="https://idp.example.com/realms/main"
AUTH_OIDC_NAME="Company SSO"
```

The `issuer` must be the base URL whose `<issuer>/.well-known/openid-configuration`
resolves — Auth.js discovers the authorization, token, and userinfo endpoints
from there. Restart the app after changing any `AUTH_OIDC_*` value (these are read
at module load in `auth.ts`; in Docker, recreate the `web` container after editing
`.env`).

---

## Email / SMTP

Mail is sent through [`../lib/mail.ts`](../lib/mail.ts). **Every message is always
persisted** to the `EmailMessage` table first, then delivery is attempted. This
gives you a durable outbox regardless of transport.

### "SMTP configured" check and outbox mode

```ts
export async function smtpConfigured() {
  const [host, port] = await Promise.all([getSetting("SMTP_HOST"), getSetting("SMTP_PORT")]);
  return Boolean(host && port);
}
```

Both values resolve through the settings precedence (Settings › Email, then `.env`).
Because `.env.example` ships `SMTP_PORT="587"` by default, the effective switch is
**`SMTP_HOST`**:

| `SMTP_HOST` | Behavior |
| --- | --- |
| **empty** | **Outbox mode.** No network send is attempted; the message row is marked `SIMULATED` (not `SENT`, so the outbox never claims a mail left the system) and is viewable under **Settings › Mail Log**. Ideal for local dev and demos. |
| **set** | The message is sent via `nodemailer` using `SMTP_PORT`, `SMTP_SECURE`, and (if `SMTP_USER` is present) `SMTP_USER`/`SMTP_PASS`, then marked `SENT`. Transient failures are retried with backoff (0.5 s, 2 s, 5 s); after the last attempt the row is marked `FAILED` with the error message. |

### Real SMTP example

```dotenv
SMTP_HOST="smtp.example.com"
SMTP_PORT="587"
SMTP_SECURE="false"                 # STARTTLS on 587; set "true" for implicit TLS (e.g. 465)
SMTP_USER="servicedesk@example.com"
SMTP_PASS="<smtp-password>"
SMTP_FROM="Servio Service Desk <servicedesk@example.com>"
```

Details verified in code:

- `SMTP_SECURE === "true"` selects implicit TLS; anything else uses STARTTLS.
- Auth is only sent when `SMTP_USER` is non-empty; otherwise the transport
  connects anonymously.
- Attachments are streamed from blob storage at send time via
  [`../lib/storage.ts`](../lib/storage.ts), so mail delivery honors the same
  storage driver as the rest of the app.

---

## AI service agent (Sable)

Sable, the built-in AI agent, is **optional and off by default**. Its behaviour is defined
in [`../lib/ai.ts`](../lib/ai.ts) and resolved through `lib/settings` (a DB `AppSetting`
row overrides `process.env`), so an admin can configure it entirely from
**Settings › Sable (AI assistant)**. This page is the environment reference; for what Sable
*does* (tools, the approve-first flow, the file map), see **[ai.md](ai.md)**.

### Choosing a provider

```dotenv
AI_PROVIDER="anthropic"   # anthropic | openai | ollama | claude-code
```

| Provider | Runs | Key | Gated by `AI_ALLOW_EXTERNAL`? |
| --- | --- | --- | --- |
| `ollama` | **Local, on-box** | none | No (self-authorized) |
| `anthropic` | External API | `ANTHROPIC_API_KEY` | **Yes** |
| `openai` | External API | `OPENAI_API_KEY` | **Yes** |
| `claude-code` | Claude Code CLI with a subscription token (`claude setup-token`) | `CLAUDE_CODE_OAUTH_TOKEN` | No (self-authorized; data still goes to Anthropic) |

### The privacy gate

`AI_ALLOW_EXTERNAL` is a hard backstop. Unless it is exactly `"true"`, `assertPrivacy()`
in `lib/ai.ts` **throws before any network call** for an external provider — so a
misconfiguration can never send ticket data off-box. This mirrors SMTP "outbox" mode:
keep an external provider selected without opening the gate and the AI features simply
stay disabled (`aiConfigured()` is false and the buttons hide).

```dotenv
# Local & private — nothing leaves the machine (recommended for a first try):
AI_PROVIDER="ollama"
OLLAMA_BASE_URL="http://localhost:11434/v1"
OLLAMA_MODEL="llama3.1"

# Hosted model — must open the gate and supply a key:
AI_PROVIDER="anthropic"        # or "openai"
AI_ALLOW_EXTERNAL="true"
ANTHROPIC_API_KEY="sk-ant-…"   # or OPENAI_API_KEY (+ optional OPENAI_BASE_URL)
```

Secrets (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`,
`TAVILY_API_KEY`, `BRAVE_API_KEY`) are encrypted at rest with
`SETTINGS_ENCRYPTION_KEY` when stored via Settings. `AI_TEASER="true"` shows the AI
buttons as a preview even when AI is off. Full reference: **[ai.md](ai.md)**.

---

## File storage / attachments

Attachment storage is defined in [`../lib/storage.ts`](../lib/storage.ts) and
upload validation in [`../lib/files.ts`](../lib/files.ts).

### Driver

`STORAGE_DRIVER` selects the adapter (default `fs`):

- **`fs`** — implemented. Uses the `FilesystemAdapter` rooted at `UPLOAD_DIR`.
- **`s3`**, **`vercel-blob`** — declared as seams (commented `case` branches);
  implement the `StorageAdapter` interface and return an instance to enable them.
- Any other value throws `Unsupported STORAGE_DRIVER` at startup.

### Upload directory (`UPLOAD_DIR`)

```dotenv
STORAGE_DRIVER="fs"
UPLOAD_DIR="./.uploads"
```

`UPLOAD_DIR` (default `./.uploads`) **must stay outside `./public`**. Blobs are
deliberately stored where Next.js can never serve them statically — every read
goes through an authorized route handler. The directory should be git-ignored and,
in production, mounted on durable/persistent storage (a stateless container's
local disk is lost on redeploy — see [deployment.md](deployment.md)).

Storage keys are server-generated as `YYYY/MM/<uuid>-<safeName>` and every key is
validated (`assertValidKey`) to reject path traversal, so user-supplied filenames
can never escape the root.

### Size cap and allowed types

```dotenv
MAX_UPLOAD_MB="15"
```

`MAX_UPLOAD_MB` sets the per-file cap (Settings › Uploads overrides the env value on
the server); [`../lib/files.ts`](../lib/files.ts) derives the client-side mirror
`MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024` from the env value. The server is
authoritative: uploads are validated against an allow-list of MIME types
(images, PDF, Office `docx`/`xlsx`/`pptx`, `txt`/`log`/`csv`) **and** magic-byte
signatures, and oversized/empty/mismatched files are rejected. See
[rest-api.md](rest-api.md) for the upload endpoint and error codes.

Uploads also pass through `proxy.ts`, for which Next.js buffers request bodies only
up to `PROXY_MAX_BODY_MB` (build time, default 32 MB). Keep the upload cap below
that value minus ~1 MB for multipart overhead; above it, uploads fail.

---

## Updates & maintenance

Settings › Updates (`/settings/updates`, ADMIN) edits `UPDATE_CHECK_ENABLED`, `UPDATE_REPOSITORY` and `UPDATE_INCLUDE_PRERELEASES` as database overrides of the environment variables above. The update-check result is cached in the `UPDATE_CACHE` setting. `SERVIO_STATE_DIR` is environment-only: it is the file contract with the updater and `proxy.ts`, so both containers must see the same directory. Operator guide: [updates.md](./updates.md).

---

## Related docs

- [development.md](development.md) — local setup, running the dev server, seeding.
- [deployment.md](deployment.md) — production values, persistence, reverse-proxy.
- [rest-api.md](rest-api.md) — API auth, CORS, and the upload endpoint.
- [updates.md](updates.md) — the updater sidecar, maintenance windows and rollback.
- [ai.md](ai.md) — Sable's tools, the approve-first flow, and its file map.
- [architecture.md](architecture.md) — how these modules fit together.
