---
name: incident-triage
description: Use when a new, unassigned or unclassified incident needs triage, or the user asks "what priority/team/category should this be", "is this a duplicate", or "how should I route this".
---

# Incident triage

Goal: a correctly classified, routed incident with duplicates and related records found.
Work read-first, then propose. Never set a category or team you have not seen in a tool result.

## Procedure
1. get_ticket for the ref. Note type, status, requester, current priority/impact/urgency,
   category, team, service, SLA, last comments.
2. Classify the type: INCIDENT = something that worked is broken or degraded.
   REQUEST = the user wants something new or changed. If the type is wrong, propose
   propose_ticket_update_field with field=type. (A catalog-style request: load service-request.)
3. Establish scope: how many users, which service, since when, any workaround. Ask the user only
   for facts the ticket and tools cannot give.
4. Search for duplicates and related records (run in parallel):
   - search_tickets with 2-3 distinctive keywords (error text, service, hostname), not the full title.
   - search_problems for a known error with a workaround; search_changes for a recent change on the
     same service (a change in the last days is the top suspect).
   - search_knowledge_base for a documented fix.
5. Decide impact and urgency, then priority (table below).
6. Route: category_list / group_list (or search_categories, search_groups, search_services) and use
   the REAL names verbatim. Unsure = leave unset and say so.
7. Propose, one call per change (see "What to propose").

## Impact x urgency -> priority
Servio values: impact and urgency are LOW / MEDIUM / HIGH; priority is LOW / MEDIUM / HIGH / CRITICAL.

| Impact \ Urgency | HIGH     | MEDIUM | LOW    |
|------------------|----------|--------|--------|
| HIGH             | CRITICAL | HIGH   | MEDIUM |
| MEDIUM           | HIGH     | MEDIUM | LOW    |
| LOW              | MEDIUM   | LOW    | LOW    |

Impact: HIGH = many users, a whole site, or a business-critical service; MEDIUM = a team or a
single important function; LOW = one user, workaround available.
Urgency: HIGH = work is blocked now, deadline, or security/data-loss risk; MEDIUM = degraded,
workaround costly; LOW = can wait.
Move one step up for VIP, safety, security or compliance exposure, and say why. The matrix is
guidance: if the ticket's current priority differs, explain rather than silently override.
Priority is its own field, so propose impact, urgency and priority separately.

## What to propose
- propose_ticket_update_field for field = impact, urgency, priority, type, team, category, service,
  assignee (assign a person only when the user asks; never on a guess).
- propose_ticket_link (relation RELATED, DUPLICATE, BLOCKS or CAUSED_BY) to related tickets.
- Duplicate of an open ticket: propose_ticket_merge if the user agrees, otherwise a DUPLICATE
  link. Never merge on title similarity alone; confirm same symptom AND same scope.
- propose_ticket_set_problem when an existing problem matches; propose_ticket_set_change when a
  change is the cause.
- propose_ticket_comment with internal=true to record the triage reasoning for the next agent.
- A documented fix in the KB: give it to the user and offer propose_article_link to attach it.

## Escalate to major incident when ANY holds
- A business-critical service is down or severely degraded for many users or a whole site.
- Impact HIGH and urgency HIGH, and several reports of the same symptom arrive quickly.
- Security incident, data loss or integrity risk.
Then load the major-incident skill. For a single ticket that is merely under-prioritised, use
propose_ticket_escalate (raises priority one level) instead.

## Output format
Short block: Classification (type, impact, urgency, priority, one-line reason) / Routing
(team, category, service) / Related (refs) / Proposed actions. Mention anything left unset and why.
