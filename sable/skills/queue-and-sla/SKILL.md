---
name: queue-and-sla
description: Use when the user asks what to work on next, to prioritise or summarise their queue or a team's workload, which tickets risk breaching SLA, or for queue statistics.
---

# Queue and SLA

## Tools
- list_my_tickets: the user's personal queue. list_team_tickets: open/unassigned tickets in their teams.
- list_tickets: filters assignee (me / unassigned / anyone), status, priority, team, limit (max 25).
- get_ticket: SLA response/resolve due dates and breach flags for ONE ticket. Call it for the
  top candidates before ranking; list output alone may not carry full SLA data.
- get_statistics (if available, admin): tickets_by_status, tickets_by_priority, tickets_by_team,
  tickets_by_category, open_tickets, tickets_created, tickets_resolved, sla_breaches,
  counts_overview (optional groupBy, timeframeDays). Never invent numbers; report what it returns.

## Ordering rules (highest first)
1. Already breached (response or resolve) and still open.
2. Major incidents and CRITICAL priority.
3. Breach risk soon: resolve or response due within the next few hours, or <25% of the SLA window
   left. Compute from due dates in get_ticket; say "due HH:MM" rather than guessing.
4. HIGH priority; many affected users; VIP or security-relevant.
5. Unassigned tickets in the user's team (someone must own them).
6. Waiting tickets (status PENDING or ON_HOLD) have the clock paused or a blocker: only check whether
   the awaited reply arrived. NEW tickets without any first response outrank old IN_PROGRESS ones
   with a pending response when response SLA is the closer deadline.
Break ties by older first, then by quick wins (a 5-minute fix that unblocks a user).
Open statuses: NEW, OPEN, IN_PROGRESS, PENDING, ON_HOLD.

## Procedure: "what next?"
1. list_my_tickets (and list_team_tickets for unassigned work if the user's list is short).
2. get_ticket on the top ~5 candidates to confirm SLA dates and latest activity.
3. Answer with a ranked list (max 5): ref, title, why it is ranked there (one clause), suggested
   next action. Then offer proposals (propose_ticket_comment, propose_ticket_update_field, ...).

## Procedure: summarise a team queue
1. list_tickets with team set; run per status or priority if counts matter (limit 25 per call,
   say so when results are truncated and do not extrapolate).
2. Report: open count, unassigned count, by priority, breached or at-risk list with refs,
   oldest ticket, anything stuck in PENDING/ON_HOLD too long.
3. Flag patterns: many tickets with one symptom (triage, possible major incident or problem);
   one person holding most tickets (workload imbalance, stated neutrally and without judging the person).
4. With get_statistics (admin) add timeframe trends: created vs resolved, sla_breaches.

## Suggested actions
- Unassigned and urgent: propose_ticket_update_field field=assignee, only with a named person the
  user chose (search_people to verify).
- Priority looks wrong: reason from impact/urgency (load incident-triage), then propose.
- At risk of breach: propose_ticket_escalate (priority up one level, notifies assignee/watchers) or
  an internal propose_ticket_comment to the owner; do not assume escalation is wanted.
- Stuck waiting: propose a follow-up comment (load customer-communication).

## Output format
Ranked table or list, short. State the data source and time (for example "from list_my_tickets just
now") and any gaps (tickets whose SLA data you could not retrieve).
