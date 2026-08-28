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
- [ ] Browser-based "use the app" runs need a one-time manual approval
      (`chrome://inspect` remote-debugging popup) before the agent's browser
      tool can drive a real Chrome instance — this can't be clicked through
      unattended on a cron run. Either Jonas approves it once interactively,
      or future "use & test" runs should exercise flows a different way
      (e.g. hitting server actions / API routes directly, or Playwright
      against a headless instance the agent controls end-to-end) instead of
      the shared desktop Chrome + CDP harness.
- [ ] (Agent: add newly discovered issues here as you find them, with date
      and a short repro/description.)

## Run log

(newest first — each entry: date, run type, what changed, verification
result, anything discovered)

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
