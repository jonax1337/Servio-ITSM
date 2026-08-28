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

- [ ] Audit-log revision viewer for KB articles (revisions are written, no UI
      to diff/restore) — feature work.
- [ ] In-memory rate limiting and the scheduler are single-instance by
      design — fine for now, revisit only if horizontal scaling comes up.
- [ ] `firstResponseBreached` is wall-clock only (documented NB in
      `lib/sla.ts`) — revisit if it causes real issues.
- [ ] (Agent: add newly discovered issues here as you find them, with date
      and a short repro/description.)

## Run log

(newest first — each entry: date, run type, what changed, verification
result, anything discovered)

- 2026-08-28 — setup: repo assessed as a good autonomous-dev candidate
  (clean main, 150/150 tests green, documented architecture, active
  maintenance). Branch `agent/servio-autodev` created. Cron scheduled.
  No code changes yet — first real run picks up from the backlog above.
