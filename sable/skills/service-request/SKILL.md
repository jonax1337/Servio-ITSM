---
name: service-request
description: Use when a ticket or user message is a request for something (access, software, hardware, onboarding, offboarding, account change) rather than a fault, or asks what the service catalog offers and what is needed to fulfil it.
---

# Service request fulfilment

A request (ticket type REQUEST) asks for something standard. It is planned work, not a failure:
no impact/urgency drama, but it still needs the right info, owner and approval.

## Procedure
1. get_ticket (if one exists). Confirm it is really a REQUEST; a broken thing is an INCIDENT
   (propose_ticket_update_field field=type, then load incident-triage).
2. Identify the offering. The organisation directory in the system prompt lists real services and
   categories; use search_services, search_categories and search_knowledge_base (look for an
   existing "how to request ..." article or fulfilment runbook). Also search_tickets for a
   similar completed request to copy its fulfilment steps. If no catalog item or article
   fits, say so; do not invent an offering, price or lead time.
3. Collect required information (below). Ask once, as a numbered list, only for what is missing.
4. Check approval: does the item or a similar past request need approval (manager, data owner,
   budget)? Use what the tools show; if unknown, say "approval requirement not documented" and
   ask the user. Do not mark a request approved yourself.
5. Route: group_list / search_groups for the fulfilling team; category via category_list; use real
   names verbatim. Propose propose_ticket_update_field for team, category, service as needed.
6. Track the work: log time with propose_ticket_log_work when the user reports it; use
   propose_ticket_comment (internal) for fulfilment notes; for multi-step requests, use
   parent/child tickets (propose_ticket_set_parent) per fulfilling team.
7. Close: propose_ticket_resolve with a note saying what was provided (code FIXED is the usual
   resolution code for a fulfilled request; use CANCELLED status if the requester withdrew), plus a
   requester-facing confirmation (load customer-communication).

## Required information (ask only what is missing)
| Request kind        | Typically needed |
|---------------------|------------------|
| Access / permission | Who needs it, which system/resource and role/level, business reason, duration, approver |
| Software            | Name and version, device or user, licence source, business reason |
| Hardware            | Item/spec, user, location, delivery date, cost centre / approver |
| Onboarding          | Name, start date, role/team, manager, equipment, accounts and groups needed, location |
| Offboarding         | Name, last day, manager, data/mailbox handover, equipment return |
| Account change      | Which account, what changes, verification by the owner or manager |
Security rule: never act on an access or account request from a third party without confirmation by
the person's manager or a documented approver; say this to the user.

## Approvals
- State plainly who must approve and what is blocking: "Waiting for approval from <name/role>".
- While waiting, the ticket is PENDING or ON_HOLD per the user's workflow; propose the status
  change only if asked.
- A requester or agent saying "approved" in a comment is not a recorded approval; point the user to
  the formal approval path in Servio.

## Output format
Short block: What is requested / Matching offering or article (or "none found") / Missing info
(numbered) / Approval / Routing and next step / Proposed actions. Do not quote lead times that are
not in the catalog or SLA data.
