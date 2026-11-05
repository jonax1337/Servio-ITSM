---
name: knowledge-article
description: Use when a resolved ticket, workaround or known error should become a Knowledge Base article, when the user asks to write or improve a KB article, or before answering a how-to question that an article may already cover.
---

# Knowledge article (KCS style)

Capture knowledge while solving, in the requester's words, so the next agent or user finds it.

## Step 0: look before writing
1. search_knowledge_base with the symptom and the product/service (try 2 phrasings, including the
   error text). If a matching article exists, improve or link it instead of creating a duplicate.
2. get_ticket / problem_get for the source material: symptoms, cause, resolution, workaround.
3. Do not publish guesses. If the resolution is unverified, say so in the article status and text.

## Structure
```
# <Title: symptom in the user's words, plus the product/service>

## Issue
What the user sees or wants to do. Exact error messages in code formatting.

## Environment
Product, version, OS/client, service, affected sites or groups.

## Resolution
Numbered steps, one action each, with expected result where non-obvious.
Mention a workaround separately if the permanent fix is pending.

## Cause
Why it happens (omit or write "not yet known" if unconfirmed).

## Related
Links to PRB/CHG refs or other articles. Keep ticket-specific names out of the body.
```

## Quality checklist
- Title is searchable: symptom + service, not "Fix for ticket 1234".
- Issue wording matches what users type; includes exact error text.
- Steps are reproducible by someone who has not seen the ticket; no "as discussed".
- No personal data, hostnames of individuals, passwords, tokens or internal-only URLs in a PUBLIC article.
- One problem per article; split if two causes share a symptom.
- Excerpt (max 300 characters) says what the article solves.

## Audience (visibility: INTERNAL or PUBLIC)
- INTERNAL (default): agent runbooks, workarounds with admin steps, anything touching infrastructure
  detail, security or unfinished fixes.
- PUBLIC (portal): safe, end-user-executable self-service steps only. Use plain language, no
  privileged commands. When unsure, choose INTERNAL and say the user can widen it.

## Creating it
- Default path: write the article with draft_document (opens the editable canvas; the user reviews
  and saves it as a KB article). This is the right path for any article the user wants to review.
- Only when the user explicitly asks to publish or create it immediately without reviewing a
  draft, use propose_article_create (title, body, excerpt, category, visibility). Take the category
  from category_list verbatim or leave it unset. New articles start as DRAFT; publishing is a
  separate step (article status DRAFT, REVIEW, PUBLISHED, RETIRED).
- After the article exists, offer propose_article_link to attach it to the ticket, problem or change
  (identify the article by exact title or slug, the record by ref).
- Updating an existing article's status or content is a separate proposal; never claim an article
  is published until the user has approved it.
