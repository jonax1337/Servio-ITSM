# ITSM usability benchmark

How many clicks, typed fields and page loads does an experienced user need for everyday
service-desk work? We measured the same 17 tasks in Servio and three established open-source
ITSM systems. The README charts are generated from the data in
[`benchmark/results.json`](./benchmark/results.json).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="benchmark/clicks-dark.svg">
  <img src="benchmark/clicks-light.svg" alt="Total clicks for 17 service-desk tasks: Servio 73, GLPI 120, Znuny 132, iTop 146" width="100%">
</picture>

Measured on 2026-11-06.

| System | Version |
| --- | --- |
| Servio | `main` after the UX benchmark fixes, local production build |
| GLPI | `glpi/glpi:latest` Docker image, using its form-based service catalog |
| iTop | 3.3.0, `vbkunin/itop` community image, ITIL setup with sample data |
| Znuny | 7.3.8 with the ITSM bundle 7.3.2, official Docker images |

## Totals

|  | Servio | GLPI | iTop | Znuny | Servio before |
| --- | --- | --- | --- | --- | --- |
| Clicks | 73 | 120 | 146 | 132 | 94 |
| Typed fields | 17 | 19 | 53 | 39 | 21 |
| Page loads | 23 | 50 | 74 | 63 | 29 |
| Script time (sum of medians) | 14.9 s | 34.5 s | 62.6 s | 38.6 s | 16.7 s |
| Tasks fully done | 17 / 17 | 15 / 17 | 12 / 17 | 15 / 17 | 15 / 17 |

"Servio before" is the same benchmark run before the fixes it led to (immediate-save ticket
properties with Undo, problem and KB article from a ticket, multi-field bulk edit, the SLA
column, affected CIs in the change form, group picker on new people).

## Features

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="benchmark/features-dark.svg">
  <img src="benchmark/features-light.svg" alt="Feature matrix for Servio, GLPI, iTop and Znuny across 22 capabilities" width="100%">
</picture>

Rated from what the UI, menus and documentation of each benchmark install showed, using the free/community editions listed above. iTop cells marked ¹ were not exercised in the install and are rated from the official iTop documentation instead.

| Capability | Servio | GLPI | iTop | Znuny |
| --- | --- | --- | --- | --- |
| **Service management** | | | | |
| Incidents | ✅ yes | ✅ yes | ✅ yes | ✅ yes |
| Service requests + catalog | ✅ yes | ✅ yes | ✅ yes | 🟡 partial |
| Problem management | ✅ yes | ✅ yes | 🟡 partial | ✅ yes |
| Changes + CAB approvals | ✅ yes | 🟡 partial | 🟡 partial | ✅ yes |
| Release management | ✅ yes | — no | — no | — no |
| CMDB + relationships | ✅ yes | ✅ yes | ✅ yes | ✅ yes |
| Knowledge base | ✅ yes | ✅ yes | 🟡 partial | 🟡 partial |
| Self-service portal | ✅ yes | ✅ yes | ✅ yes | ✅ yes |
| SLAs with business hours | ✅ yes | ✅ yes | 🟡 partial | ✅ yes |
| **Platform and integration** | | | | |
| Email in/out + threading | ✅ yes | ✅ yes | ✅ yes ¹ | ✅ yes |
| Automations / workflows | ✅ yes | ✅ yes | 🟡 partial ¹ | ✅ yes |
| Dashboards / reporting | 🟡 partial | 🟡 partial | 🟡 partial | 🟡 partial |
| REST API | ✅ yes | ✅ yes | ✅ yes | ✅ yes |
| SSO / LDAP sync | ✅ yes | ✅ yes | ✅ yes ¹ | ✅ yes |
| Custom fields | ✅ yes | 🟡 partial | 🟡 partial ¹ | ✅ yes |
| Multiple UI languages | — no | ✅ yes | ✅ yes | ✅ yes |
| **Beyond the service desk** | | | | |
| Public status page | ✅ yes | — no | — no ¹ | — no |
| On-call schedules | ✅ yes | — no | — no ¹ | — no |
| Contracts / licenses | ✅ yes | ✅ yes | 🟡 partial | 🟡 partial |
| Built-in AI assistant | ✅ yes | — no | — no ¹ | — no |
| **Experience** | | | | |
| Mobile / responsive UI | 🟡 partial | 🟡 partial | 🟡 partial ¹ | 🟡 partial |
| Accessibility basics | 🟡 partial | 🟡 partial | 🟡 partial ¹ | 🟡 partial |

### Notes on partial and missing support

**Servio**

- *Dashboards / reporting* (partial): Customizable widget dashboards (number, trend, breakdown, aging, CSAT, SLA and MTTR) with per-widget filters, SLA tiles that open the filtered ticket list, CSV export of tickets. No report builder or scheduled reports.
- *Multiple UI languages* (no): English-only UI; no i18n library or locale files in package.json/repo.
- *Built-in AI assistant* (yes): Built-in Sable agent: chat, read tools, approve-first write operations, insights, portal assistant. Present in the UI; answer quality was not benchmarked because no AI provider was configured for the run.
- *Mobile / responsive UI* (partial): Measured before the mobile fixes in this release: the portal fitted 390 px without horizontal overflow, the console ticket page overflowed (similar-tickets row, conversation bubbles) although the shell collapses to a top bar. Not re-measured since.
- *Accessibility basics* (partial): Programmatic scan of /tickets, /tickets/:id, /problems: 0 visible controls without an accessible name, html lang=en, one h1, checkbox rows have aria-labels; command palette via Ctrl/Cmd+K. No skip-to-content link. Contrast not measured. Select/combobox controls are custom (button-based) widgets.

**GLPI**

- *Changes + CAB approvals* (partial): Changes with impact/control/rollout/backout/checklist text areas, approval requests (user / group / group-user, multi-step with required percentage), tasks. No dedicated planned start/end or risk fields, no CAB meeting/voting object, no change freeze windows; Assistance > Planning is a personal task calendar, not a change calendar.
- *Release management* (no): No release/deployment object in the Assistance menu (only Tickets, Problems, Changes, Planning, Statistics, recurrent tickets/changes).
- *Dashboards / reporting* (partial): Home 'Global View' shows status counts per ITIL object, Assistance > Statistics (after choosing report type and dates), Tools > Reports, saved searches/exports, central dashboards for permitted profiles. No ready SLA-breach report for a Supervisor (see T15).
- *Custom fields* (partial): Form builder questions (portal forms), asset definitions with custom fields, ticket templates (mandatory/hidden/predefined fields). Free custom fields on built-in Ticket/Change objects need the Fields plugin (marketplace, not core).
- *Public status page* (no): No public status page / service status object in core.
- *On-call schedules* (no): No on-call rota; Planning/reservations only.
- *Built-in AI assistant* (no): No AI agent/assistant in core GLPI 12.0.1 (the UI exposes none).
- *Mobile / responsive UI* (partial): Tabler-based layout with collapsible sidebar and viewport meta; not formally tested on a phone viewport in this bench (desktop 1440x900 only), and wide list/ticket screens with a side panel are dense on small widths.
- *Accessibility basics* (partial): Skip links ('Go to main content', 'Go to main navigation'), ARIA roles on tabs/menus, labelled form fields, high-contrast option in user preferences. Gaps seen: icon-only controls without text (solution/KB toggles, ticket footer chevron/dots), select2 dropdowns everywhere, many hidden duplicate form copies in the ticket DOM.

**iTop**

- *Problem management* (partial): Problem + Known Error exist, but no create-from-incident action; linking incidents is via Parent problem field / bulk modify (T9).
- *Changes + CAB approvals* (partial): Normal/Routine/Emergency change with Validate > Assign > Plan > Approve lifecycle and approver queue (T12/T13); no Risk field, single approver rather than CAB voting. Change calendar/freeze not found in menus.
- *Release management* (no): No release module in the installed ITIL set (no menu entry seen).
- *Knowledge base* (partial): FAQ module (categories + FAQs), portal FAQ list; no create-from-ticket (T14), no ticket linkage.
- *SLAs with business hours* (partial): SLA/SLT/Customer contract objects and 'Under escalation' lists exist; no SLA breach/at-risk dashboard (T15); list empty in seed, not verified with live breaches.
- *Automations / workflows* (partial): Core triggers (lifecycle, TTO/TTR thresholds, object changes) with email, webhook and newsroom actions; no rule-based routing or auto-assignment found in Community. Sources: [1](https://www.itophub.io/wiki/page?id=latest%3Aadmin%3Anotifications).
- *Dashboards / reporting* (partial): Overview dashboards per module (priority pie, status/agent/customer tables); no SLA widgets in the default ones.
- *Custom fields* (partial): Community adds fields through an XML datamodel extension; the no-code ITSM Designer is a paid offer. Sources: [1](https://www.itophub.io/wiki/page?id=3_0_0%3Acustomization%3Aadd-attribute-sample), [2](https://combodo.com/offers-services/).
- *Public status page* (no): No public status page in core or in the official extension list; Communications to the Customers only shows announcements inside iTop. Sources: [1](https://www.itophub.io/wiki/page?id=extensions%3Astart), [2](https://www.itophub.io/wiki/page?id=extensions%3Aitop-communications).
- *On-call schedules* (no): No on-call or rotation feature in core or in the official extension list. Sources: [1](https://www.itophub.io/wiki/page?id=extensions%3Astart).
- *Contracts / licenses* (partial): Customer and provider contracts present in Service management; license management not checked.
- *Built-in AI assistant* (no): No built-in AI; Combodo publishes an early MCP server (v0.0.1) that lets external AI clients call the REST API. Sources: [1](https://www.itophub.io/wiki/page?id=extensions%3Aitop-mcp).
- *Mobile / responsive UI* (partial): The end-user portal is responsive; the back-office console is not designed for phones. Sources: [1](https://www.itophub.io/wiki/page?id=latest%3Aportal%3Aportal_v2).
- *Accessibility basics* (partial): iTop 3.2 adds WCAG AA colour-blind and high-contrast console themes in Community; keyboard use and labels were not verified. Sources: [1](https://combodo.com/itop/itsm-accessible-for-everyone-with-itop/).

**Znuny**

- *Service requests + catalog* (partial): No service catalog. Ticket type ServiceRequest + Service/SLA pickers exist; a 'New laptop'-style item with its own form needs Process Management (activity dialogs + dynamic fields), which is a flowchart editor in the admin UI.
- *Release management* (no): No release management in the ITSM bundle.
- *Knowledge base* (partial): Only with the separate FAQ package (installed FAQ 7.3.11): categories, approval, public/internal/external states, agent + customer search/explorer, links to tickets. Not in core/ITSM bundle.
- *Dashboards / reporting* (partial): Agent dashboard widgets (escalated, reminder, new, open tickets, 7-day stats), Statistics module (needs stats group), no BI-style custom dashboards.
- *Public status page* (no): No public status page.
- *On-call schedules* (no): No on-call/rota scheduling (only agent absence/out-of-office, calendars).
- *Contracts / licenses* (partial): Service Level Management package covers service-level agreements / underpinning contracts as objects; no license management.
- *Built-in AI assistant* (no): None in the OSS edition.
- *Mobile / responsive UI* (partial): 7.x ships a refreshed skin that scales, but agent forms are dense desktop forms and some actions open pop-up windows.
- *Accessibility basics* (partial): Labels and aria on most inputs, keyboard shortcuts (q/w/...); modern dropdown widget replaces native selects (needs mouse/arrow keys), contrast is mid.

## Per task

Cells are `clicks · typed fields`. Bold marks the fewest clicks among the systems that
fully completed the task.

| Task | Role | Servio | GLPI | iTop | Znuny |
| --- | --- | --- | --- | --- | --- |
| **T1** Submit an incident in self-service with category and attachment | End user | **5 · 2** | **5 · 2** | **5 · 3** | 7 · 2 |
| **T2** Find my open request and reply | End user | **2 · 1** | 3 · 1 | 3 · 1 | **2 · 1** |
| **T3** Search the KB for "VPN" and open the article | End user | **1 · 1** | **1 · 1** | 2 · 1 | 3 · 1 |
| **T4** Order the "New laptop" catalog item with one custom field | End user | 4 · 1 | **3 · 1** | 3 · 3 (partial) | not supported |
| **T5** Find the new incident, assign it to myself, set priority High | Agent | **6 · 0** | 9 · 0 | 12 · 0 | 10 · 5 |
| **T6** Reply to the requester and add an internal note | Agent | **4 · 2** | 6 · 2 | 7 · 2 | 5 · 3 |
| **T7** Link the incident to a CI and to a related incident | Agent | **6 · 0** | 12 · 0 | 10 · 2 | 11 · 2 |
| **T8** Resolve with a resolution note (and close if separate) | Agent | 3 · 1 | 7 · 1 | 9 · 1 | **2 · 2** |
| **T9** Create a problem from two related incidents | Agent | **6 · 0** | 9 · 0 | 14 · 5 | 12 · 4 |
| **T10** Find an asset by serial number via global search | Agent | **2 · 1** | **2 · 1** | 3 · 1 | 8 · 1 |
| **T11** Bulk-set 5 tickets to In progress / assign a group | Agent | 9 · 0 | 15 · 0 | 11 · 1 (partial) | **8 · 1** |
| **T12** Create a normal change with window, risk and CI, submit for approval | Manager | **9 · 5** | 18 · 4 (partial) | 29 · 16 (partial) | 29 · 8 |
| **T13** Approve the change | Manager | **2 · 0** | 3 · 0 | 7 · 3 | 8 · 0 |
| **T14** Create a KB article from a resolved ticket | Agent | **3 · 0** | 6 · 1 | 5 · 4 (partial) | 5 · 4 (partial) |
| **T15** See SLA breaches and at-risk tickets | Manager | 1 · 0 | 4 · 0 (partial) | 2 · 0 (partial) | **0 · 0** |
| **T16** Add an agent and put them in a group | Admin | **7 · 2** | 11 · 4 | 16 · 8 | 9 · 4 |
| **T17** Add a ticket category/service selectable in the portal | Admin | **3 · 1** | 6 · 1 | 8 · 2 | 13 · 1 |

## Method

Every system got the same seed data before measuring: three users (end user, agent, manager),
two groups, five services or categories, ten assets with one known serial number, twenty
tickets including two related printer incidents, three KB articles and a "New laptop" catalog
item with one custom field. Existing demo data was used where a system ships it.

Each task is a Playwright script that takes the shortest path an experienced user would take
through visible UI: menus, buttons, global search and advertised shortcuts, with no URL jumps
except the task's start page. Login is not counted. The script counts:

| Metric | Definition |
| --- | --- |
| Clicks | Pointer activations: links, buttons, selects, checkboxes, tabs. Opening a dropdown and picking an option counts as 2. |
| Typed fields | Fields that need keyboard input, each counted once regardless of length. |
| Page loads | Full navigations or route changes until the task is visibly done. |
| Script time | Wall-clock time of the script in Chromium at 1440 × 900 with a warm cache; median of 3 runs. |

A task is **partial** when the system can only do it with a workaround, and **not supported**
when it has no way to do it. Click counts were identical across the three runs of every task.

## Limits of the comparison

- Partial tasks usually take fewer clicks because part of the work is missing, so the totals
  favour systems with gaps. Znuny's T4 counts 0 clicks because it has no service catalog.
- Servio ran as a local production build and the other systems in Docker on the same machine.
  Script time therefore includes each environment's response time; clicks and fields do not.
- Znuny needs the SysConfig option `ITSMChange::Frontend::AgentITSMChangeEdit###ChangeState`
  enabled for T12 and T13; it was enabled before measuring.
- In the iTop community image the bulk "Assign" transition fails with a PHP error, so iTop's
  T11 measures a bulk change of urgency instead.
- GLPI changes have no planned window or risk field; T12 uses the opening and time-to-resolve
  dates instead.
- GLPI, iTop and Znuny cannot create a KB article from a ticket (T14); the text is retyped.
- Znuny shows escalated tickets on the agent dashboard, so T15 takes no click there; in Servio
  it is one click on the dashboard tile.
- The benchmark was designed and run by the Servio project. The scripts favour no system on
  purpose, but treat the results as a well-documented self-assessment, not an independent test.

## Updating the chart

Edit [`benchmark/results.json`](./benchmark/results.json) with the new measurements, then run:

```bash
pnpm benchmark:chart   # rewrites the clicks-* and features-* SVGs in docs/benchmark/
```

Update the tables on this page and the numbers in the README's comparison section to match.
