@AGENTS.md

## Project documentation

Full docs live in [`docs/`](docs/README.md). Consult them before making changes:

- [`docs/architecture.md`](docs/architecture.md) — runtime model (Server Components / Server Actions in `lib/actions/*` / Route Handlers in `app/api/*`), route groups (`app/(console)`, `app/portal`, `app/login`), Auth.js v5 split config, RBAC in `proxy.ts`, and the sync engine.
- [`docs/modules.md`](docs/modules.md) — the feature-to-file map; use it to find the exact files for any module.
- [`docs/data-model.md`](docs/data-model.md) — the Prisma schema by domain and the `String`-backed enum strategy (`lib/constants.ts`).
- [`docs/ai.md`](docs/ai.md) — **Sable**, the built-in AI agent: providers (local Ollama / Anthropic / OpenAI / Claude CLI), the `AI_ALLOW_EXTERNAL` privacy gate, read tools, and the RBAC-gated approve-first write flow (`lib/ai.ts`, `lib/ai-operations/*`).
- [`docs/rest-api.md`](docs/rest-api.md), [`docs/configuration.md`](docs/configuration.md), [`docs/design-system.md`](docs/design-system.md), [`docs/deployment.md`](docs/deployment.md).
- [`docs/branding.md`](docs/branding.md) — Servio Relay / Sable Nova Flow, shared vector components, local Manrope, generated runtime assets; use `pnpm brand:sync` and `pnpm brand:check` for kit changes.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — coding conventions and the step-by-step "add a module" recipe. **Read this before adding a feature.**

Key gotchas: this is Next.js 16 with breaking changes (read `node_modules/next/dist/docs/`); base-ui uses `render` (not `asChild`) and `Select` needs `items`; enums are `String` columns validated via `lib/constants.ts`; the middleware is `proxy.ts`.
