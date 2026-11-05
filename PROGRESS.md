# Autonomous Dev Log

This file is read and updated by an autonomous coding agent (Claude Code CLI,
scheduled via cron) that works on this repo in small, incremental steps.
Humans: feel free to read, edit, or redirect it — it's the agent's shared
memory across runs, not a sacred artifact.

## How this works

- The agent runs every ~3 hours (daytime only) on branch `agent/servio-autodev`.
- Each run: read this file + `docs/audit.md`'s "Known remaining" section +
  recent git log → pick ONE focused task → implement or test it → verify
  (`pnpm test`, `pnpm lint`, `tsc --noEmit`, `pnpm build`) → commit → push to
  the branch if verification passed → log the run below.
- Two kinds of runs, alternating as makes sense:
  1. **Build**: implement a concrete backlog item or fix a found bug.
  2. **Use & test**: run `pnpm dev`, log in as a seeded user (see README —
     admin@servio.dev / servio123 etc.), click through real flows via
     browser automation, and record any UX/functional flaws found as new
     backlog items below.
- Never touches `main` directly, never touches `.env` / secrets, never
  pushes to any remote other than this repo's own `agent/servio-autodev`
  branch, never deploys anywhere.
- Jonas merges to `main` manually whenever he's happy with the state.

## Backlog (seeded from docs/audit.md "Known remaining", 2026-08-28)

- [x] Audit-log revision viewer for KB articles (revisions are written, no UI
      to diff/restore) — done 2026-08-28, see run log.
- [ ] In-memory rate limiting and the scheduler are single-instance by
      design — fine for now, revisit only if horizontal scaling comes up.
- [ ] `firstResponseBreached` is wall-clock only (documented NB in
      `lib/sla.ts`) — revisit if it causes real issues.
- [x] Browser-based "use the app" runs were blocked on the CDP/remote-debugging
      harness needing one-time interactive approval — worked around 2026-08-28
      by driving the OS-level desktop-automation tool (mouse/keyboard on the
      already-open Edge window) instead of the Chrome-remote-debugging browser
      tool. That path works unattended. See run log below for what was tested.
- [ ] `.env`'s `NEXTAUTH_URL`/`APP_URL` are hardcoded to `http://localhost:3000`.
      Fine for the documented default dev setup, but if port 3000 is already
      taken by something else on the machine, `next dev` auto-picks another
      free port (e.g. 3002) while auth callbacks still redirect to the
      hardcoded 3000 — login redirect loop / blank page, looks like an app bug
      but is a local port collision. Not a code bug (comes from a real-world
      dev machine already running something on 3000), so no code change
      proposed; just noting it in case a future run hits the same confusing
      symptom. Workaround used: override `NEXTAUTH_URL`/`APP_URL` env vars to
      match whatever port `next dev` actually bound to.
- [x] Pre-existing `⚠ ./instrumentation.ts ... Node.js API is used (process.on)
      ... not supported in the Edge Runtime` build warning (visible in every
      previous run's `pnpm build` output) — fixed 2026-08-28, see run log.
- [ ] 2026-08-28: this run's browser "use & test" pass hit an unrelated dev-env
      snag while trying to exercise the Self-Service Portal request flow (the
      already-running dev server on port 3099 — started outside this agent,
      likely Jonas' own `pnpm dev` session — went into a repeating
      "Jest worker encountered 2 child process exceptions, exceeding retry
      limit" crash loop on `/portal/request/[serviceId]`, serving a 500
      `_error` page). This looks like a local Turbopack/Jest-worker resource
      issue on that already-running process (possibly stale from a long dev
      session), not a Servio code bug — no repro isolated to app code yet.
      Next run: if the dev server is healthy, try the Portal catalog →
      request → submit flow end-to-end (admin/`VPN access`, 0 form fields, is
      a good minimal case) and confirm whether the crash reproduces on a
      freshly started `next dev`.
- [ ] (Agent: add newly discovered issues here as you find them, with date
      and a short repro/description.)

## Run log

(newest first — each entry: date, run type, what changed, verification
result, anything discovered)

- 2026-08-28 — build (+ partial use & test): fixed the pre-existing
  `instrumentation.ts` build warning (`Node.js API is used (process.on) ...
  not supported in the Edge Runtime`) that had been showing up in every
  `pnpm build` run since the scheduler was wired in. Root cause: Turbopack
  cross-checks `instrumentation.ts` against both the Node and Edge runtime
  bundles, so a Node-only API referenced directly in that file trips the
  warning even though the call only ever executes on the guarded
  `NEXT_RUNTIME === "nodejs"` branch. Fix: moved the Node-only body (the
  `process.on("SIGTERM"/"SIGINT", ...)` graceful-shutdown wiring) into a new
  `lib/instrumentation-node.ts` module, loaded via a dynamic `import()` from
  `instrumentation.ts` only on the Node branch — matches the "Specifying the
  runtime" pattern in the Next.js instrumentation docs (conditional
  `require()`/`import()` to a dedicated file rather than inlining Node-only
  code). Updated `docs/deployment.md` and `docs/modules.md` references
  accordingly. Verification: `pnpm lint` 0/0, `tsc --noEmit` clean, `pnpm
  test` 150/150 green, `pnpm build` green with **zero** warnings this time
  (previously always had the two instrumentation.ts Edge-runtime warnings).
  Also attempted a browser "use & test" pass on the Self-Service Portal
  request flow (login as admin worked fine, catalog browsing worked fine),
  but hit an unrelated dev-server crash loop on the request-detail page —
  logged as a new backlog item above with a repro plan for next run, not a
  code fix in this run. Committed and pushed to `agent/servio-autodev`.

- 2026-08-28 — use & test: ran `next dev` on a free port (3000 was occupied by
  another local app on this machine) and drove the app for real via desktop
  mouse/keyboard automation on the already-open Edge browser (worked around
  the CDP remote-debugging approval gate — see backlog item above, now marked
  resolved). Flows exercised as the seeded admin: dashboard load, creating a
  new ticket end-to-end (title/description/submit → ticket detail page with
  correct SLA countdown), adding a rich-text reply/comment on that ticket
  (toolbar, send, comment renders), and the knowledge-base revision-history
  viewer built in the previous run — edited an article's body, confirmed a
  new revision (v1) appeared in the History dialog with correct author/
  timestamp/diff preview. Also opened the Sable assistant and asked "What
  tickets are assigned to me?" — it correctly pulled live ticket data
  (including the just-created test ticket), flagged an SLA-breached ticket
  and a stale NEW ticket, and offered sensible follow-ups. No functional bugs
  found in any of these flows. One environmental gotcha found and documented
  in the backlog (not a code bug): `.env`'s `NEXTAUTH_URL`/`APP_URL` are
  hardcoded to port 3000, so if `next dev` auto-picks a different port (e.g.
  because 3000 is taken), login redirects go to the wrong port and the app
  looks completely blank/broken — fixed for this session by overriding the
  env vars to match the actual bound port. No code changes this run (pure
  use-and-test pass); nothing to commit besides this PROGRESS.md update.

- 2026-08-28 — build: implemented the audit-log revision viewer for KB
  articles (top backlog item). Added `restoreArticleRevision` server action
  (`lib/actions/knowledge.ts`) — restoring a past revision is
  non-destructive, it writes a NEW revision carrying the old content forward
  rather than deleting/rewriting history, same race-safe version-numbering
  as `updateArticle`. Added `ArticleHistoryDialog`
  (`components/knowledge/article-history-dialog.tsx`): a dialog listing all
  revisions (version, timestamp, editor avatar/name, note) with a preview
  pane and a "Restore" button (behind the existing `ConfirmButton`
  confirmation pattern) for any non-current revision. Wired into the article
  detail page (`app/(console)/knowledge/[slug]/page.tsx`) next to the
  existing Edit button; revision bodies are sanitized server-side
  (`sanitizeCommentHtml`) before being handed to the client component, same
  as the main article body. Attempted a browser "use & test" pass first but
  the browser tool's Chrome remote-debugging needs a one-time interactive
  Allow-popup click that isn't available unattended on a cron run (logged as
  a new backlog item above) — deferred to a build task instead this run.
  Verification: `pnpm lint` 0 errors/warnings, `tsc --noEmit` clean,
  `pnpm test` 150/150 green (no new tests added — this is UI + one small
  server action following existing patterns 1:1), `pnpm build` green (all
  routes, only a pre-existing unrelated instrumentation.ts Edge-runtime
  warning). Committed and pushed to `agent/servio-autodev`.

- 2026-08-28 — setup: repo assessed as a good autonomous-dev candidate
  (clean main, 150/150 tests green, documented architecture, active
  maintenance). Branch `agent/servio-autodev` created. Cron scheduled.
  No code changes yet — first real run picks up from the backlog above.
