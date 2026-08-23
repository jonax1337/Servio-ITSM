---
description: Update docs/ and README.md to match uncommitted code changes
argument-hint: [optional git range, e.g. main..HEAD]
allowed-tools: Read, Grep, Glob, Edit, Bash(node scripts/check-doc-drift.mjs*), Bash(git diff*), Bash(git status*)
---

You are keeping Servio's documentation in lockstep with its code. Update `docs/**` and `README.md` so they accurately reflect the current code — no more, no less.

## What changed

Drift report (code whose owning doc was NOT updated):
!`node scripts/check-doc-drift.mjs --working --porcelain || true`

Changed files:
!`git diff --name-only --diff-filter=ACMR $ARGUMENTS ; git diff --cached --name-only --diff-filter=ACMR`

Diff stat:
!`git diff --stat $ARGUMENTS`

## Ownership map (which doc owns which code)

The authoritative code→doc mapping lives in `scripts/check-doc-drift.mjs` (the `DOC_MAP` array). Read it first if you're unsure which doc to touch. Summary:

- `prisma/schema.prisma`, `lib/constants.ts` → `docs/data-model.md`
- `lib/ai*`, `lib/ai-operations/**`, `lib/assistant*`, `lib/rag/**`, `lib/portal-assistant.ts` → `docs/ai.md`
- `app/api/v1/**`, `lib/api.ts` → `docs/rest-api.md`
- `lib/settings.ts`, `lib/crypto.ts`, `lib/actions/settings.ts` → `docs/configuration.md`
- `auth.ts`, `auth.config.ts`, `proxy.ts`, `lib/session.ts` → `docs/architecture.md`
- `lib/connectors/**`, `lib/sync-runner.ts`, `lib/mail*`, `lib/scheduler.ts` → `docs/modules.md`
- `Dockerfile`, `docker-compose.yml`, `docker/**`, `instrumentation.ts` → `docs/deployment.md`
- `components/ui/**`, `app/globals.css` → `docs/design-system.md`
- `lib/actions/**`, `app/(console)/**`, `app/portal/**` → `docs/modules.md` (+ `README.md` if it's a user-facing feature)

## How to do it

1. For each changed code area in the drift report, **read the actual changed code** (use the diff + Read) to understand what the change really does — do not guess from the filename.
2. Open the owning doc(s) and update only the sections the change affects. Fix stale claims, add newly-introduced behavior, remove documentation for anything that was deleted.
3. If a change adds/removes a **user-facing capability**, also update the feature overview in `README.md`.
4. When the change touches a `String`-backed enum (`lib/constants.ts`) that has a mirrored comment in `prisma/schema.prisma` or a listing in `docs/data-model.md`, update those to match exactly.
5. Match each file's existing tone and structure. Be precise and concise. **Never document a bug or a security gap as intended behavior** — if the code looks wrong, note it in your summary instead of enshrining it in the docs.
6. Do not touch `docs/audit.md` (a point-in-time audit snapshot) or the auto-generated agent block in `AGENTS.md`.

## Finish

Re-run the drift check to confirm it's clean:
!`node scripts/check-doc-drift.mjs --working --porcelain || echo "no drift"`

Then give a short summary: which docs you changed and the one-line reason for each. If any changed code area needs no doc update, say so and why.
