---
name: problem-management
description: Use when incidents keep recurring, a major incident needs root cause analysis, or the user asks to open, investigate, document or close a problem or known error.
---

# Problem management

A problem is the underlying cause of one or more incidents. Goal: find the cause, or at
least document a workaround (known error) so incidents are resolved fast in the meantime.

## When to open a problem
- Same symptom on 3+ incidents, or the same incident returns after being resolved.
- A major incident needs root cause analysis.
- An incident was resolved with resolution code WORKAROUND only.
- Do NOT open one for a one-off user error or a single already-understood fault.
Check first: search_problems with symptom keywords. Link to an existing problem instead of
creating a duplicate.

## Procedure
1. Collect evidence: search_tickets (keywords, service) and get_ticket on the 3-5 clearest cases;
   compare start times, affected users, hosts, versions, error text.
2. Correlate with change: search_changes on the same service for the 7-14 days before the first
   incident; note CHG refs and dates. Correlation is a lead, not proof.
3. Propose creation: propose_problem_create (title = symptom + service, description = scope and
   evidence, priority and impact from the worst linked incident, team via group_list).
4. Link incidents: propose_ticket_set_problem for each (a ticket has at most one problem).
5. Record findings with propose_problem_comment as the investigation progresses.
6. Move status with propose_problem_update_field (field=status). Servio problem statuses:
   NEW, INVESTIGATING, KNOWN_ERROR (cause known, no permanent fix yet), RESOLVED, CLOSED.
7. A permanent fix needs a change: propose_change_create, then propose_change_set_problem.

## RCA methods
- 5 Whys: ask "why" until the cause is actionable and under our control. Write the chain into the
  problem comment. Stop at a process or configuration cause, not at "human error".
- Timeline: list events in order (change, first alert, first ticket, workaround, recovery).
  Gaps in the timeline are the questions to ask next.
- Change correlation: which changes touched the service before onset? Did onset follow the
  rollout order?
- Scope contrast: who or what is affected vs not (site, version, group, hardware). The difference
  usually points at the cause.
- Label each hypothesis confirmed / refuted / open. Never state a cause as fact until confirmed.

## Known error and workaround
When status becomes KNOWN_ERROR the problem comment must contain:
```
Symptoms: <what the user sees, in searchable wording>
Cause: <known cause, or "under investigation">
Workaround: <numbered steps, tested>
Permanent fix: <CHG ref / planned / none>
Affected: <services, versions>
```
Then offer a KB article for the workaround (load knowledge-article; INTERNAL unless end users can
apply it themselves) and attach it with propose_article_link to the problem.

## Closing
Resolve only after the fix change is closed and no new linked incidents arrived for a reasonable
period. Use problem_get to review linked incidents first, then propose status RESOLVED with
propose_problem_update_field and summarise cause, fix and CHG ref in propose_problem_comment.
