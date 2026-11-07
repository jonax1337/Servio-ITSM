# Servio documentation

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../branding/exports/banners/readme-servio-dark.svg">
  <img src="../branding/exports/banners/readme-servio-light.svg" alt="Servio Relay — the open-source service desk" width="100%">
</picture>

Developer and operator documentation for **Servio**, an open-source ITSM platform
built with Next.js 16, React 19, Prisma 6, and Auth.js v5. Every page is verified
against the code and kept in sync with the repository.

- **Running Servio?** Use the published Docker images: [deployment.md](./deployment.md#-docker),
  then [updates.md](./updates.md) for in-app updates.
- **Working on the code?** Start with [development.md](./development.md), then read
  [architecture.md](./architecture.md).

## Getting started

| Doc | What it covers |
| --- | --- |
| [development.md](./development.md) | Local setup, quickstart, demo credentials/API token, project layout, and the core coding conventions. |
| [configuration.md](./configuration.md) | Every environment variable, plus SSO/OIDC, SMTP, AI (Sable), and file-storage configuration. |

## Reference

| Doc | What it covers |
| --- | --- |
| [architecture.md](./architecture.md) | Runtime model, request paths (Server Components / Server Actions / Route Handlers), route groups, auth, RBAC, and the sync engine. |
| [ai.md](./ai.md) | **Sable**, the built-in AI agent: providers (local Ollama / Anthropic / OpenAI / Claude CLI), the privacy gate, read tools, and the RBAC-gated approve-first write flow. |
| [data-model.md](./data-model.md) | The Prisma schema by domain, the String-backed enum strategy, human reference numbers, and the migration workflow. |
| [rest-api.md](./rest-api.md) | The versioned `/api/v1` Bearer-token REST API: auth, scopes, envelope, pagination, and every endpoint. |
| [design-system.md](./design-system.md) | Theme tokens, typography, the base-ui/shadcn setup, primitive library, and shared composite components. |
| [branding.md](./branding.md) | Relay/Nova Flow, canonical assets, fonts, generated application files and sync commands. |
| [modules.md](./modules.md) | The feature-to-file map for every console and portal module. |
| [audit.md](./audit.md) | The 2026-08-23 remediation audit (a dated snapshot, not kept in sync). |
| [benchmark.md](./benchmark.md) | The ITSM usability benchmark against GLPI, iTop and Znuny: per-task clicks and fields, method, limits, and how to regenerate the README chart. |

## Operations

| Doc | What it covers |
| --- | --- |
| [deployment.md](./deployment.md) | Installing from the published Docker images, moving to PostgreSQL, production environment, build/run from source, persistent storage, and scheduled background work. |
| [updates.md](./updates.md) | Self-update with maintenance windows: how releases are found and installed by the updater sidecar, the maintenance page, setup, security and rollback. |
| [releasing.md](./releasing.md) | The CI checks on every PR, cutting a release with `pnpm release` and a version tag, the multi-arch GHCR images and the GitHub Release, and Dependabot. |

## Contributing

| Doc | What it covers |
| --- | --- |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Workflow, canonical reference files, the "add a module" recipe, gotchas, and PR expectations. |
| [maintaining-docs.md](./maintaining-docs.md) | How the docs stay in sync with the code: the `/sync-docs` command, the session-stop reminder, and the commit-time drift gate. |

---

See also the root [README](../README.md) for a project overview and
[CONTRIBUTING.md](../CONTRIBUTING.md) for the contributor workflow.
