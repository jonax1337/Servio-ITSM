# ⚙️ Configuration

This is the environment and configuration reference for Servio. All runtime
configuration is supplied through environment variables — there is no separate
config file. Copy [`../.env.example`](../.env.example) to `.env` and edit it.

Servio is designed to run with **zero required setup for local development**:
with a fresh checkout you only need `DATABASE_URL` and `AUTH_SECRET`. Every
integration (SSO, SMTP, AI/Sable, non-local storage) is optional and degrades
gracefully when left unconfigured.

See also: [development.md](development.md) for the local dev loop, and
[deployment.md](deployment.md) for hardening these values in production.

> **Admin Settings override `.env`.** Most application-level config (SMTP, AI
> provider/model/keys, branding `APP_NAME`/`APP_URL`, `MAX_UPLOAD_MB`) can now be
> managed from the UI under **Settings** (ADMIN only) and is stored in the
> `AppSetting` table. Precedence for every key is **DB row → `process.env` →
> built-in default**, so an empty table falls back to `.env` and nothing breaks
> until an admin overrides a value. Secrets (SMTP password, AI API keys) are
> encrypted at rest (AES-256-GCM) using `SETTINGS_ENCRYPTION_KEY`. Resolution
> lives in [`../lib/settings.ts`](../lib/settings.ts) + [`../lib/crypto.ts`](../lib/crypto.ts).
> Bootstrap secrets (`DATABASE_URL`, `AUTH_SECRET`, `SETTINGS_ENCRYPTION_KEY`) and
> OIDC/SSO stay `.env`-only.

---

## Environment variable reference

The table below is derived from [`../.env.example`](../.env.example) **and** a
grep of every `process.env.*` read in the codebase. Variables marked
_(not in `.env.example`)_ are real but undocumented in the sample file.

| Variable | Required? | Default | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` | **Yes** | — | Prisma connection string. Consumed via `env("DATABASE_URL")` in [`../prisma/schema.prisma`](../prisma/schema.prisma). Default provider is `sqlite` (`file:./dev.db`); swap the datasource `provider` to `postgresql` for production. |
| `AUTH_SECRET` | **Yes** | — | Secret used by Auth.js to sign/encrypt the JWT session. Read implicitly by `next-auth`. See [generating `AUTH_SECRET`](#generating-auth_secret). |
| `AUTH_TRUST_HOST` | Recommended | — | Set `true` to trust the incoming host header (needed behind a reverse proxy). Note: [`../auth.config.ts`](../auth.config.ts) hard-codes `trustHost: true`, so this is belt-and-suspenders. |
| `NEXTAUTH_URL` | No | `http://localhost:3000` | Canonical app URL for Auth.js callback/redirect resolution. Not read directly by app code; consumed by `next-auth` when host inference is undesirable. |
| `AUTH_OIDC_ID` | No | — | OIDC/OAuth **client ID**. Presence of this **and** `AUTH_OIDC_ISSUER` enables SSO. See [SSO / OIDC setup](#sso--oidc-setup). |
| `AUTH_OIDC_SECRET` | No | — | OIDC client secret. Passed to the provider; not part of the enable gate. |
| `AUTH_OIDC_ISSUER` | No | — | OIDC issuer URL (the IdP's discovery base, e.g. `https://idp/realms/main`). Required to enable SSO. |
| `AUTH_OIDC_NAME` | No | `SSO` | Display name for the SSO button ("Continue with _{name}_"). |
| `APP_NAME` | No | `Servio` | Application display name. Present in `.env.example` as a convention; not currently read by app code. |
| `APP_URL` | No | _empty_ | Public app origin used to build **absolute links** in outbound mail and CSAT survey links (`lib/mail.ts`, `lib/actions/survey.ts`). Also settable from **Settings** (the DB `AppSetting` row wins). When empty, survey links fall back to a relative path. |
| `SMTP_HOST` | No | _empty_ | SMTP server host. **Leaving it empty enables outbox mode** — see [Email / SMTP](#email--smtp). |
| `SMTP_PORT` | No | `587` | SMTP port. Together with `SMTP_HOST` it forms the "SMTP configured" check in [`../lib/mail.ts`](../lib/mail.ts). |
| `SMTP_SECURE` | No | `false` | `"true"` to use an implicit TLS connection (typically port 465); any other value uses STARTTLS. |
| `SMTP_USER` | No | — | SMTP auth username. If empty, the transport connects **without** auth. |
| `SMTP_PASS` | No | — | SMTP auth password (only used when `SMTP_USER` is set). |
| `SMTP_FROM` | No | `Servio <servio@localhost>` | Envelope/`From` header for outgoing mail. |
| `STORAGE_DRIVER` | No | `fs` | Blob storage driver. Only `fs` is implemented; `s3` and `vercel-blob` are seams in [`../lib/storage.ts`](../lib/storage.ts). An unknown value throws at startup. |
| `UPLOAD_DIR` | No | `./.uploads` | Filesystem root for the `fs` driver. **Must stay outside `./public`** — see [File storage](#file-storage--attachments). |
| `MAX_UPLOAD_MB` | No | `15` | Per-file upload cap in MB. [`../lib/files.ts`](../lib/files.ts) derives `MAX_UPLOAD_BYTES` from it. |
| `AI_PROVIDER` | No | `anthropic` | Sable's AI backend: `anthropic` \| `openai` \| `ollama` \| `claude-code`. See [AI service agent (Sable)](#ai-service-agent-sable). |
| `AI_ALLOW_EXTERNAL` | No | `false` | **Privacy gate.** Must be exactly `"true"` to allow an external provider (`anthropic`/`openai`); `ollama`/`claude-code` are not gated. |
| `AI_MODEL` | No | provider default | Explicit model id. Blank falls back to `claude-opus-4-8` / `gpt-4o` / `$OLLAMA_MODEL`. |
| `AI_MAX_OUTPUT_TOKENS` | No | `1024` | Cap on AI output tokens per call. |
| `AI_TEASER` | No | `false` | When AI is **off**, still show the AI buttons as a disabled preview (a "ask your admin" nudge). |
| `AI_TICKET_TRIAGE` | No | `true` | Show Sable's inline triage suggestions (priority/type/team/category) when an agent opens a ticket. Turn off to hide them; chat and request handling stay on. |
| `ANTHROPIC_API_KEY` | No | — | Anthropic key. Secret — encrypted at rest when set via Settings. Only used when `AI_PROVIDER=anthropic` **and** the gate is open. |
| `OPENAI_API_KEY` | No | — | OpenAI (compatible) key. Secret. Only used when `AI_PROVIDER=openai` **and** the gate is open. |
| `OPENAI_BASE_URL` _(not in `.env.example`)_ | No | — | Override the OpenAI endpoint to reach any OpenAI-compatible cloud (OpenAI, OpenRouter, Moonshot/Kimi, Zhipu/GLM…). |
| `OLLAMA_BASE_URL` | No | `http://localhost:11434/v1` | Local Ollama endpoint (OpenAI-compatible). No key required. |
| `OLLAMA_MODEL` | No | `llama3.1` | Local Ollama model id. |
| `WEB_SEARCH_PROVIDER` | No | `auto` | Backend for Sable's `web_search` tool: `tavily` \| `brave` \| `duckduckgo` \| `auto`. `auto` uses a configured key (Tavily → Brave) else the keyless DuckDuckGo scraper. |
| `TAVILY_API_KEY` | No | — | [Tavily](https://app.tavily.com) key (LLM-oriented search, clean results; free tier ~1k/mo). Secret. |
| `BRAVE_API_KEY` | No | — | [Brave Search](https://brave.com/search/api) key (independent web index; free tier ~2k/mo). Secret. |
| `GOTENBERG_URL` | No | — | Optional [Gotenberg](https://gotenberg.dev) (LibreOffice) service, e.g. `http://gotenberg:3000`. When set, office docs (docx/pptx/legacy/ODF) preview as a faithful PDF; blank = built-in best-effort text/HTML. See [deployment.md](deployment.md#-docker). |
| `SETTINGS_ENCRYPTION_KEY` | Recommended | — | 32-byte key (base64/hex) that encrypts secret settings (SMTP password, AI keys) stored in the DB. Bootstrap secret — `.env`-only. |
| `API_CORS_ORIGIN` | No | _unset ⇒ no CORS header_ | Allowed origin for the bearer-token REST API responses. Default-**closed**: when unset no `Access-Control-Allow-Origin` is emitted, so browsers treat the API as same-origin-only (curl/server clients unaffected). Read in [`../lib/api.ts`](../lib/api.ts). See [rest-api.md](rest-api.md). |
| `API_RATE_LIMIT` | No | `120` | Max REST API requests per token (falling back to client IP) per window. Read in [`../lib/rate-limit.ts`](../lib/rate-limit.ts); in-memory, per-process — see the multi-instance caveat in [deployment.md](deployment.md). |
| `API_RATE_WINDOW_MS` | No | `60000` | Sliding-window length (ms) for `API_RATE_LIMIT`. |
| `AI_RATE_LIMIT` | No | `20` | Max AI-endpoint requests (console + portal chat, confirm-create, triage) per session user per window — every request drives a provider call. |
| `AI_RATE_WINDOW_MS` | No | `60000` | Sliding-window length (ms) for `AI_RATE_LIMIT`. |
| `LOGIN_FREE_ATTEMPTS` | No | `5` | Failed login attempts allowed before backoff kicks in ([`../lib/rate-limit.ts`](../lib/rate-limit.ts)). |
| `LOGIN_BASE_BACKOFF_MS` | No | `2000` | Base backoff delay (ms) after the free attempts are used; grows per subsequent failure. |
| `LOGIN_MAX_BACKOFF_MS` | No | `900000` | Cap (ms, 15 min) on the login backoff delay. |
| `LOGIN_DECAY_MS` | No | `900000` | Idle window (ms, 15 min) after which a login's failure count decays/resets. |
| `SCHEDULER_ENABLED` | No | `true` | Master switch for the in-process background scheduler (SLA escalation sweep, inbound-mail poll, scheduled syncs), read by [`../lib/scheduler.ts`](../lib/scheduler.ts) via [`../instrumentation.ts`](../instrumentation.ts). Set `"false"` on every replica except the designated scheduler instance — see the multi-instance notes in [deployment.md](deployment.md). |
| `NEXT_PUBLIC_DEMO_MODE` | No | `false` | Set `"true"` to keep the pre-filled demo credentials (`admin@servio.dev` / `servio123`) and their hint on the login page ([`../app/login/login-form.tsx`](../app/login/login-form.tsx)) visible in production builds. They always show outside production and are hidden in production unless this is set. |
| `NODE_ENV` | No | — | Standard Node/Next env. Toggles Prisma query logging ([`../lib/db.ts`](../lib/db.ts)) and the HMR-safe singleton guards in `lib/db.ts` / `lib/storage.ts`. |

> **Tip for agents:** the enable gates are literal `Boolean(process.env.X && ...)`
> checks. An empty string is falsy in JS, so an empty value in `.env` is
> equivalent to the variable being unset for every optional feature here.

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

Then set it in `.env`:

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
    allowDangerousEmailAccountLinking: true,
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
- `allowDangerousEmailAccountLinking: true` links an OIDC identity to an existing
  local account with the same email. Only enable SSO against an IdP whose email
  verification you trust.
- Session role/id come from the JWT callbacks in
  [`../auth.config.ts`](../auth.config.ts); a first-time OIDC user gets the
  default `USER` role via the Prisma adapter.

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
at module load in `auth.ts`).

---

## Email / SMTP

Mail is sent through [`../lib/mail.ts`](../lib/mail.ts). **Every message is always
persisted** to the `EmailMessage` table first, then delivery is attempted. This
gives you a durable outbox regardless of transport.

### "SMTP configured" check and outbox mode

```ts
export function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT);
}
```

Because `.env.example` ships `SMTP_PORT="587"` by default, the effective switch is
**`SMTP_HOST`**:

| `SMTP_HOST` | Behavior |
| --- | --- |
| **empty** | **Outbox mode.** No network send is attempted; the message row is marked `SENT` (simulated delivery) and is viewable under **Settings › Mail**. Ideal for local dev and demos. |
| **set** | The message is sent via `nodemailer` using `SMTP_PORT`, `SMTP_SECURE`, and (if `SMTP_USER` is present) `SMTP_USER`/`SMTP_PASS`, then marked `SENT`. On failure the row is marked `FAILED` with the error message. |

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
| `claude-code` | Local `claude` CLI (your Pro/Max login) | none | No (self-authorized) |

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

Secrets (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) are encrypted at rest with
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

`MAX_UPLOAD_MB` sets the per-file cap; [`../lib/files.ts`](../lib/files.ts)
derives `MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024`. The server is
authoritative: uploads are validated against an allow-list of MIME types
(images, PDF, Office `docx`/`xlsx`/`pptx`, `txt`/`log`/`csv`) **and** magic-byte
signatures, and oversized/empty/mismatched files are rejected. See
[rest-api.md](rest-api.md) for the upload endpoint and error codes.

---

## Related docs

- [development.md](development.md) — local setup, running the dev server, seeding.
- [deployment.md](deployment.md) — production values, persistence, reverse-proxy.
- [rest-api.md](rest-api.md) — API auth, CORS, and the upload endpoint.
- [ai.md](ai.md) — Sable's tools, the approve-first flow, and its file map.
- [architecture.md](architecture.md) — how these modules fit together.
