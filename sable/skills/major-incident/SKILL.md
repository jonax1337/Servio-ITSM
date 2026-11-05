---
name: major-incident
description: Use when an incident affects many users or a critical service, when asked to declare or manage a major incident, or when several tickets report the same outage.
---

# Major incident

A major incident (MI) is a ticket flagged as major incident in Servio. Declaring it raises the
priority to CRITICAL and notifies watchers. Speed and clear communication matter more than polish.

## Criteria (any one)
- Business-critical service unavailable or severely degraded for many users or a whole site.
- Security breach, data loss or corruption in progress.
- Many tickets (rule of thumb: 3+ in a short window) with the same symptom.
- Impact HIGH and urgency HIGH on a customer-facing or safety-relevant service.
If it is borderline, say so, give the facts for and against, and let the user decide.

## Immediate actions (first 15 minutes)
1. get_ticket on the lead ticket; search_tickets for the same symptom to find all reports
   (list_tickets with priority HIGH or CRITICAL helps spot a spike).
2. search_changes for changes on the affected service in the last days: a recent change is the
   top hypothesis. Note it; do not assume it.
3. search_problems and search_knowledge_base for a known error or runbook.
4. Propose, each once:
   - propose_ticket_major_incident (on=true) on the lead ticket; on=false clears the flag later.
   - propose_ticket_update_field for team / service so the right team owns it.
   - propose_ticket_set_parent for each duplicate report (ref = reported ticket, target = lead
     ticket). Children keep their own requester; the lead ticket carries the work.
   - propose_ticket_comment with internal=true: a timeline entry (time, observation, action, owner).
5. Suggest roles: incident lead (coordinates), technical owner (fixes), communications owner
   (updates). Name only real people or teams found via search_people / search_groups.

## Communication cadence
- First notice soon after declaration, then updates at a fixed interval (for CRITICAL typically
  every 30 minutes, or whatever the user agrees), even with nothing new: "No change, next update HH:MM".
- Requester-facing updates are public comments (load customer-communication); engineering detail
  stays in internal notes. Never promise an ETA the technical owner has not given.

### Update template
```
Subject: [Major incident] <service> - <Investigating | Identified | Mitigating | Resolved>
What is affected: <users / sites / functions>
Since: <time, timezone>
Current status: <what we know, in plain words>
Workaround: <if any, else "none yet">
Next update: <time>
```

## Resolving
- Confirm recovery with the technical owner and check that new reports have stopped.
- propose_ticket_resolve on the lead ticket (code FIXED or WORKAROUND, with a note). Whether open
  child tickets are resolved with it is chosen by the user in the UI; mention it.
- Send a resolution notice (template above, status Resolved, plus cause if known).

## Handover to problem management
Always open or link a problem after an MI: propose_problem_create (priority from the MI,
description = timeline and symptoms), then propose_ticket_set_problem for the lead ticket and
propose_problem_comment with the evidence. Load problem-management for the RCA.

## Post-incident review checklist
- Timeline: detection, declaration, mitigation, recovery (times from the ticket history).
- Detection: how long until we knew; user report or monitoring?
- Cause (or "unknown, tracked in PRB-xxxx") and contributing factors, including related changes.
- What went well and badly in communication and handoffs.
- Actions with owner and due date; a KB article for the workaround (load knowledge-article).
Offer the review as a draft_document (RCA style) instead of a long chat message.
