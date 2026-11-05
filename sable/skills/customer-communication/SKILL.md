---
name: customer-communication
description: Use when drafting or proposing a reply, status update, request for information or resolution note to a requester or customer on a ticket, or when deciding whether a comment should be internal or public.
---

# Customer communication

## Internal vs public (propose_ticket_comment)
- `internal=true`: agents-only note. Not visible to the requester. Use for triage reasoning,
  troubleshooting steps, hand-offs, suspected causes, anything unverified.
- `internal` unset/false: a PUBLIC reply that is emailed to the requester. Everything in it must be
  safe for the requester to read and forward.
- Default to internal when unsure, and tell the user which kind you proposed. Say explicitly when a
  proposal will email the requester.
- Never put secrets, other people's personal data, internal hostnames or blame in a public comment.

## Before drafting
1. get_ticket: requester, status, latest comments (answer what was asked, do not repeat what was
   already said), SLA dates, type.
2. Check what is actually known: workaround in the KB (search_knowledge_base), related problem or
   major incident status. Do not describe causes or fixes you have not seen in a tool result.
3. Match the requester's language and register (formal vs casual). Reply in the language of their
   last message, even if the user is chatting with you in another one; tell the user which language you used.

## Tone rules
- Lead with what matters to them: status and next step, in the first two lines.
- Plain words, short sentences, no jargon or ticket-system terms. Active voice.
- Acknowledge impact once, sincerely, without drama or over-apology.
- One clear ask at a time when you need information; number questions when there are several.
- No promises about outcome or time unless backed by data (below).

## ETAs and promises
Only state a time when it comes from the ticket's SLA due dates (get_ticket) or from a person who
owns the work. Phrase it as "our target is ...", not a guarantee. If there is no basis, say when the
next update will come ("We will update you by <time>") rather than when it will be fixed. Never
quote SLA internals or breach status to the requester.

## Templates (adapt; replace every <placeholder> with real values)
Acknowledge:
```
Hello <name>,
thank you for reporting this. We have recorded it as <ref> and <team> is looking into it.
To help us, could you tell us <specific question>?
We will update you by <time/date>.
```
Update:
```
Hello <name>,
a quick update on <ref>: <what we found or did, in one or two sentences>.
Next step: <what happens next and who>. We will update you again by <time/date>.
```
Need information:
```
Hello <name>,
to continue with <ref> we need:
1. <item>
2. <item>
Once we have this we can <next step>.
```
Resolve (pair with propose_ticket_resolve; its note is visible to the requester unless internal):
```
Hello <name>,
<ref> is resolved: <what was done / what the fix is>.
If you see the problem again, simply reply here and we will pick it up.
```
Workaround only: say it is a workaround, give the steps, and say the permanent fix is tracked.

## Procedure
Draft the text, show it to the user, then propose it with propose_ticket_comment (or as the note
of propose_ticket_resolve). Propose once. If the user asked only for wording, give the draft and
do not propose. For several tickets of one incident, one shared wording plus per-ticket proposals.
