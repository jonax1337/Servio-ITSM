---
name: change-management
description: Use when planning, reviewing or creating a change (maintenance, rollout, emergency fix), assessing change risk, or checking whether a change is ready for CAB approval.
---

# Change management

Servio changes start as DRAFT and move through APPROVAL, APPROVED, SCHEDULED, IN_PROGRESS,
REVIEW, CLOSED (or REJECTED, FAILED, CANCELLED). Normal changes get CAB approvals.

## Change type (CHANGE_TYPES)
| Type      | Use when                                                        | Approval path |
|-----------|-----------------------------------------------------------------|---------------|
| STANDARD  | Pre-approved, repeatable, low risk, documented procedure        | Minimal; follow the procedure exactly |
| NORMAL    | Planned change with non-trivial risk or impact                  | Full review and CAB approval |
| EMERGENCY | Needed now to restore service or stop a security/data-loss risk | Expedited approval, full review afterwards |
Do not use EMERGENCY to skip planning for something that was merely forgotten. If the user wants to,
say that plainly. Check with search_changes whether a similar STANDARD change exists.

## Risk assessment (risk: LOW / MEDIUM / HIGH)
Score each 1-3, then judge the sum: 3-4 LOW, 5-7 MEDIUM, 8-9 HIGH.
- Blast radius: one user/host (1), a team/service (2), site or critical shared service (3).
- Complexity / novelty: routine (1), some unknowns (2), first time or many dependencies (3).
- Reversibility: instant rollback (1), rollback with effort (2), no clean rollback (3).
Raise one level for business-critical timing (month-end, peak hours) or recent failures on the
same service (search_changes, search_problems). Explain the score in one line per factor.

## Required plan sections
A change is not ready without all of these:
1. Reason and expected benefit (link the problem or incidents that drive it).
2. Scope: services, assets, users affected; impact during the change window.
3. Implementation plan: numbered steps, owner per step, duration.
4. Test / verification plan: how success is confirmed, who confirms.
5. Backout plan: trigger conditions, exact steps, time to restore, tested if possible.
6. Schedule: start/end, maintenance window, freeze periods respected.
7. Communication plan: who is told before, during, after; downtime notice text.
8. Roles: implementer, assigned team, approvers.

When the user asks you to create a change, the deliverable is ONE complete propose_change_create,
never a canvas draft (do not call draft_document for a change). Map the sections to its fields:
- reason: section 1. implementationPlan: sections 3 and 4. rollbackPlan: section 5.
- plannedStart / plannedEnd: section 6 as "YYYY-MM-DD HH:mm" (resolve the year from the current date).
- description: sections 2, 7 and 8, plus freeze periods or dependencies.
- type, risk, priority, impact, team, category, assignee, problem: verified values only.
Fill what the user gave you; write a sound draft for the rest and say in one line which parts are
your assumptions. Ask instead only when a fact you cannot reasonably assume (the window, the
affected service) is missing.

## CAB readiness checklist
- Type, risk, priority, impact set and consistent with the assessment.
- All eight plan sections present; backout is concrete, not "restore from backup".
- Linked problem or incidents (propose_change_set_problem, propose_ticket_set_change).
- No conflicting changes in the same window on the same service (search_changes).
- Owner team and assignee set (names verified via group_list / search_people).
Report gaps as a short list; do not mark a change ready if any item fails.

## Procedure and tools
1. Read: change_get for an existing change; search_changes for conflicts and history;
   search_problems / get_ticket for the driver.
2. Create: propose_change_create with every field above filled. Starts as DRAFT.
3. Adjust: propose_change_update_field (field = status, type, risk, priority, impact, team,
   category, assignee); propose_change_set_plan (reason, implementationPlan, rollbackPlan);
   propose_change_set_window (planned start and end). Closing and cancelling have their own
   operations that need an outcome/closure notes or a reason; ask the user for those instead of
   inventing them.
4. Document progress with propose_change_comment.
5. Link: propose_change_set_problem (change fixes problem); propose_ticket_set_change (incident or
   request tied to the change).
6. After implementation, check results against the test plan and record the outcome; a failed change
   should lead to a problem or a rework change.
