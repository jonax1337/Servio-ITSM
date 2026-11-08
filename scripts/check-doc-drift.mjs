#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Documentation drift checker
// -----------------------------------------------------------------------------
// Flags commits where CODE in a domain changed but its mapped DOC(s) did not, so
// docs/ and README never silently fall behind the code. It is intentionally
// dumb-but-deterministic: it does not read the diff's meaning, only whether the
// docs that OWN a changed area were also touched. The actual doc rewrite is done
// by the `/sync-docs` Claude command; this script only nudges/gates.
//
// Modes:
//   --staged              check git's staged set (default; used by the commit-msg hook)
//   --range <base>..<head>  check a commit range (used by the session-stop hook / CI)
//   --working             check unstaged + staged working-tree changes
//   --msg-file <path>     read a commit message file; a `[skip-docs]` marker disables the gate
//
// Exit codes:
//   0  no drift, or drift but non-strict (advisory), or skipped
//   1  drift found AND strict mode (DOCS_STRICT=1 or --strict)  -> blocks the commit
//
// Escape hatches:
//   - put `[skip-docs]` in the commit message
//   - `SKIP_DOCS_CHECK=1 git commit ...`
//   - `git commit --no-verify` (skips all hooks)
//
// The DOC_MAP below is the single source of truth for "which doc owns which code"
// and is also what `/sync-docs` consults. Keep it in sync when you add a module.
// -----------------------------------------------------------------------------

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

/**
 * Each rule: when any changed file matches `code`, at least one of `docs` (or
 * README.md) must also have changed. `code` entries are matched as path
 * prefixes OR substrings (both, so "lib/ai" catches lib/ai.ts and lib/ai-tools.ts).
 */
const DOC_MAP = [
  {
    label: 'Data model / Prisma schema',
    code: ['prisma/schema.prisma', 'lib/constants.ts'],
    docs: ['docs/data-model.md'],
  },
  {
    label: 'AI agent (Sable) & portal assistant',
    code: [
      'lib/ai.ts', 'lib/ai-tools.ts', 'lib/ai-admin-tools.ts', 'lib/ai-context.ts',
      'lib/ai-operations/', 'lib/ai-projects.ts', 'lib/assistant-core.ts',
      'lib/assistant-tools.ts', 'lib/rag/', 'lib/portal-assistant.ts',
      'lib/actions/ai.ts', 'lib/actions/ai-assistant.ts', 'lib/claude-cli.ts',
      'lib/claude-agent-events.ts', 'lib/llm-proxy/', 'lib/sable-workspace.ts', 'lib/sable-skills.ts', 'lib/sable-mcp.ts',
      'lib/sable-mcp-policy.ts', 'lib/ai-models.ts', 'lib/actions/sable-skills.ts',
      'lib/actions/sable-mcp.ts', 'sable/',
      'lib/ai-insights', 'lib/ai-similarity', 'lib/actions/ai-insights.ts', 'lib/change-brief',
      'lib/actions/change-copilot.ts', 'lib/sla-nudge-rules.ts', 'lib/dashboard/briefing',
    ],
    docs: ['docs/ai.md'],
  },
  {
    label: 'Public REST API (v1)',
    code: ['app/api/v1/', 'lib/api.ts'],
    docs: ['docs/rest-api.md'],
  },
  {
    label: 'Configuration & settings',
    code: ['lib/settings.ts', 'lib/crypto.ts', 'lib/actions/settings.ts'],
    docs: ['docs/configuration.md'],
  },
  {
    label: 'Architecture / auth / middleware',
    code: ['auth.ts', 'auth.config.ts', 'proxy.ts', 'lib/session.ts', 'lib/actions/auth.ts'],
    docs: ['docs/architecture.md'],
  },
  {
    label: 'Sync engine & connectors',
    code: ['lib/connectors/', 'lib/sync-runner.ts', 'lib/actions/syncs.ts'],
    docs: ['docs/modules.md'],
  },
  {
    label: 'Mail engine',
    code: ['lib/mail.ts', 'lib/mail-inbound/', 'lib/mail-template.ts', 'lib/email-templates.ts', 'lib/scheduler.ts'],
    docs: ['docs/modules.md'],
  },
  {
    label: 'Scheduler feature ticks',
    code: ['lib/ticks/'],
    docs: ['docs/architecture.md', 'docs/configuration.md'],
  },
  {
    label: 'Operations modules (calendar, templates, releases, on-call, status, contracts, recurring tickets, tabs)',
    code: [
      'lib/entity-tabs.ts', 'lib/change-schedule', 'lib/change-template', 'lib/release',
      'lib/oncall', 'lib/status-', 'lib/contract-', 'lib/ticks/contracts.ts',
      'lib/recurring-ticket', 'lib/ticks/recurring-tickets.ts', 'components/recurring-tickets/',
      'components/entity-tabs.tsx', 'components/oncall/', 'components/status/',
      'components/releases/', 'components/contracts/', 'components/changes/calendar/',
      'components/changes/templates/', 'components/changes/tabs/', 'components/tickets/tabs/',
      'components/problems/tabs/', 'components/assets/tabs/',
    ],
    docs: ['docs/modules.md'],
  },
  {
    label: 'Updates & maintenance windows',
    code: [
      'lib/maintenance', 'lib/updates.ts', 'lib/update-rules.ts', 'lib/state-dir.ts', 'lib/ticks/maintenance.ts',
      'lib/ticks/update-check.ts', 'lib/actions/maintenance.ts', 'updater/', 'docker-compose.release.yml',
      'app/maintenance', 'app/api/maintenance', 'app/(console)/settings/updates', 'components/maintenance/',
    ],
    docs: ['docs/updates.md'],
  },
  {
    label: 'Deployment / runtime / containers',
    code: ['Dockerfile', 'docker-compose.yml', 'docker/', 'instrumentation.ts', 'next.config.ts'],
    docs: ['docs/deployment.md'],
  },
  {
    label: 'CI & release workflows',
    code: ['.github/', 'scripts/release.mjs'],
    docs: ['docs/releasing.md'],
  },
  {
    label: 'Design system / UI primitives',
    code: ['components/ui/', 'app/globals.css', 'components.json'],
    docs: ['docs/design-system.md'],
  },
  {
    label: 'Feature modules (server actions & console/portal routes)',
    code: ['lib/actions/', 'app/(console)/', 'app/portal/'],
    docs: ['docs/modules.md'],
  },
]

// --- arg parsing --------------------------------------------------------------
const argv = process.argv.slice(2)
const getArg = (name) => {
  const i = argv.indexOf(name)
  return i !== -1 ? argv[i + 1] : undefined
}
const mode = argv.includes('--range') ? 'range'
  : argv.includes('--working') ? 'working'
  : 'staged'
const rangeSpec = getArg('--range')
const msgFile = getArg('--msg-file')
const strict = argv.includes('--strict') || process.env.DOCS_STRICT === '1'
// --porcelain: emit one plain `label\tdoc1,doc2` line per gap to stdout and exit
// 1 if any drift (regardless of strict). Consumed by the session-stop hook.
const porcelain = argv.includes('--porcelain')

// --- skip checks --------------------------------------------------------------
if (process.env.SKIP_DOCS_CHECK === '1') process.exit(0)
if (msgFile && existsSync(msgFile)) {
  const msg = readFileSync(msgFile, 'utf8')
  if (/\[skip-docs\]/i.test(msg)) process.exit(0)
}

// --- collect changed files ----------------------------------------------------
// execFileSync with an argument array — no shell, so a crafted --range value
// cannot inject commands.
function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return ''
  }
}

let changed = ''
if (mode === 'staged') {
  changed = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
} else if (mode === 'working') {
  changed = git(['diff', '--name-only', '--diff-filter=ACMR']) + '\n' +
            git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
} else if (mode === 'range') {
  const spec = rangeSpec && rangeSpec.includes('..') ? rangeSpec : `${rangeSpec || 'HEAD~1'}..HEAD`
  changed = git(['diff', '--name-only', '--diff-filter=ACMR', spec])
}

const files = [...new Set(
  changed.split('\n').map((f) => f.trim().replace(/\\/g, '/')).filter(Boolean),
)]

if (files.length === 0) process.exit(0)

const matches = (file, patterns) =>
  patterns.some((p) => {
    const pat = p.replace(/\\/g, '/')
    return file === pat || file.startsWith(pat) || file.includes(pat)
  })

const changedDocs = files.filter((f) => f.startsWith('docs/') || f === 'README.md')

// --- evaluate rules -----------------------------------------------------------
const gaps = []
for (const rule of DOC_MAP) {
  const hitCode = files.filter((f) => !f.startsWith('docs/') && f !== 'README.md' && matches(f, rule.code))
  if (hitCode.length === 0) continue
  // A rule is satisfied only by its own owning doc(s). A README edit does NOT
  // excuse an untouched owning doc (README covers the feature overview, not the
  // detailed reference each rule points at).
  const docTouched = rule.docs.some((d) => changedDocs.includes(d))
  if (!docTouched) gaps.push({ rule, hitCode })
}

if (gaps.length === 0) process.exit(0)

// --- porcelain (machine-readable) ---------------------------------------------
if (porcelain) {
  for (const { rule } of gaps) process.stdout.write(`${rule.label}\t${rule.docs.join(',')}\n`)
  process.exit(1)
}

// --- report -------------------------------------------------------------------
const bold = (s) => `\x1b[1m${s}\x1b[0m`
const yellow = (s) => `\x1b[33m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

const lines = []
lines.push('')
lines.push(yellow('  ┌─ documentation drift ' + '─'.repeat(38)))
lines.push(yellow('  │'))
for (const { rule, hitCode } of gaps) {
  lines.push(yellow('  │  ') + bold(rule.label))
  for (const f of hitCode.slice(0, 5)) lines.push(yellow('  │    ') + dim('changed: ') + f)
  if (hitCode.length > 5) lines.push(yellow('  │    ') + dim(`… +${hitCode.length - 5} more`))
  lines.push(yellow('  │    ') + '→ update ' + bold(rule.docs.join(', ')) + dim(' (+ README.md if user-facing)'))
  lines.push(yellow('  │'))
}
lines.push(yellow('  │  ') + 'Fix it: run ' + bold('/sync-docs') + ' in Claude Code, then stage the docs.')
lines.push(yellow('  │  ') + dim('Skip once: add ') + '[skip-docs]' + dim(' to the commit message, or ') + 'git commit --no-verify')
lines.push(yellow('  └' + '─'.repeat(60)))
lines.push('')
process.stderr.write(lines.join('\n') + '\n')

if (strict) {
  process.stderr.write('  ' + bold('DOCS_STRICT is on — commit blocked until docs are updated or skipped.\n\n'))
  process.exit(1)
}
process.exit(0)
