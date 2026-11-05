# Branding integration reference

Servio uses **Relay** as its product identity and **Nova Flow** for **Sable**,
its embedded AI teammate. Nova Flow is the approved six-segment organic mark;
the assistant's product name remains Sable.

## Canonical sources

| Source | Responsibility |
| --- | --- |
| [`branding/source/brand.json`](../branding/source/brand.json) | Names, palette, typography and spacing rules |
| [`branding/source/marks.json`](../branding/source/marks.json) | Approved Relay and Nova Flow vector geometry |
| [`branding/fonts`](../branding/fonts/README.md) | Manrope variable font, print instances and font license |
| [`branding/exports`](../branding/README.md) | Outlined SVGs, PNGs, icons, README/social banners, patterns and wallpapers |
| [`branding/brand-guide.pdf`](../branding/brand-guide.pdf) | Visual identity guidelines |
| [`branding/index.html`](../branding/index.html) | Asset gallery and downloads |

The selected raster references remain as provenance. Runtime assets use the
reconstructed vectors, including outlined wordmarks.

## Application components

| Component | Behaviour |
| --- | --- |
| `Logo` in `components/brand.tsx` | Relay; Cobalt on light surfaces and white on dark |
| `BrandName` in `components/brand.tsx` | Outlined wordmark for `brand="servio"` or `brand="sable"` |
| `Wordmark` in `components/brand.tsx` | Servio symbol and wordmark, optional subtitle |
| `SableMark` in `components/sable-mark.tsx` | Filled Nova Flow, inheriting colour; `accent` enables Cobalt/Ice; SVG attributes and forwarded SVG ref |

These components serve the sidebar, login, portal, Sable chat, launcher, inline
AI controls, settings and command navigation. The assistant nav entry and
breadcrumb are named **Sable**. The floating launcher is hidden while the
dedicated `/assistant` page is open. Functional status icons retain their own
semantic colours.

## Fonts and theme

`app/layout.tsx` loads Manrope from the local kit through `next/font/local` as
`--font-display`. Headings use Manrope; body text and tables use Inter; code and
reference numbers use JetBrains Mono. The latter two use `next/font/google`
and are self-hosted in the built application. Outlined SVG wordmarks do not
depend on browser font shaping.

`app/brand-tokens.css` is generated from the canonical palette. `app/globals.css`
maps it to interface roles and adds derived surface colours. The light primary
is Cobalt `#3559E8`; the dark primary uses `#8FAAFF` for readable links and
controls against Navy. Sable uses monochrome controls and a Navy launcher with
the two-colour symbol. [design-system.md](./design-system.md) lists exact tokens.

## Browser and share assets

| Output | Purpose |
| --- | --- |
| `app/favicon.ico`, `app/icon.svg` | Servio browser icons |
| `app/apple-icon.png` | Apple touch icon |
| `app/opengraph-image.png`, `app/twitter-image.png` | File-based share images |
| `app/(console)/assistant/icon.svg` | Sable icon for the dedicated assistant page |
| `public/brand/{servio,sable}/` | PWA icons, favicons and manifest templates |

Root metadata references `/brand/servio/site.webmanifest` and defines light/dark
browser theme colours. Absolute share-image URLs use the build-time `APP_URL`,
falling back to `AUTH_URL`, `NEXTAUTH_URL` and then the local development origin.
Docker Compose forwards `APP_URL` as a build argument. Rebuild after changing
the public share-image origin. The static `/brand/` namespace is public before login.
The shared route policy matches whole segments; `/brand-settings` and protected
console routes still require authentication.

## Generation commands

| Command | Result |
| --- | --- |
| `python branding/tools/build.py` | SVGs, print font instances, runtime geometry, PNG export plan |
| `npm --prefix branding run build` | Complete authoring build: kit, PDF, icons, manifest, ZIP |
| `pnpm brand:sync` | Selected runtime files, `lib/brand-assets.ts`, `app/brand-tokens.css` |
| `pnpm brand:check` | Read-only validation of application copies, with a stale-file error on drift |
| `pnpm build` | Brand validation followed by the normal Next.js build |

`scripts/sync-brand-assets.mjs` is Node-only. Its outputs are committed build
inputs. Normal deployment does not run the Python/PDF authoring toolchain.
Full kit dependencies and rebuilding instructions are in
[branding/README.md](../branding/README.md).
