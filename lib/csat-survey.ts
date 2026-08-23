import "server-only";

import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";

/**
 * CSAT (Customer Satisfaction) survey internals.
 *
 * A survey is created when a ticket is resolved (see setTicketResolution in
 * lib/actions/tickets.ts). The requester gets a link to a PUBLIC rating page
 * (/survey/<token>) — no login required — carrying an unguessable token.
 *
 * These helpers live outside the "use server" module on purpose: minting
 * tokens for arbitrary tickets must never be reachable as an HTTP endpoint.
 */

/**
 * Ensure a ticket has a SurveyResponse row and return its token. Idempotent:
 * re-resolving a ticket reuses the existing survey (one per ticket — ticketId is
 * @unique) rather than orphaning the old link. Safe to call from the resolve
 * hook; never throws (returns null on failure so mail still sends).
 */
export async function ensureSurvey(ticketId: number): Promise<string | null> {
  try {
    const existing = await db.surveyResponse.findUnique({
      where: { ticketId },
      select: { token: true },
    });
    if (existing) return existing.token;
    const token = randomUUID().replace(/-/g, "");
    const created = await db.surveyResponse.create({
      data: { ticketId, token },
      select: { token: true },
    });
    return created.token;
  } catch {
    return null;
  }
}

/** Absolute URL to the public rating page for a token (APP_URL or a relative fallback). */
export async function surveyUrl(token: string): Promise<string> {
  const base = (await getSetting("APP_URL")) || "";
  const path = `/survey/${token}`;
  return base ? `${base.replace(/\/$/, "")}${path}` : path;
}

/** Look up a survey by token for the public page. Returns null for unknown tokens. */
export async function getSurveyByToken(token: string) {
  if (!token) return null;
  return db.surveyResponse.findUnique({
    where: { token },
    select: {
      token: true,
      rating: true,
      comment: true,
      respondedAt: true,
      ticket: { select: { id: true, prefix: true, title: true } },
    },
  });
}
