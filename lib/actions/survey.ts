"use server";

import { db } from "@/lib/db";
import { SURVEY_RATING_MIN, SURVEY_RATING_MAX } from "@/lib/constants";

/**
 * CSAT (Customer Satisfaction) survey submission endpoint.
 *
 * A survey is created when a ticket is resolved (see setTicketResolution in
 * lib/actions/tickets.ts). The requester gets a link to a PUBLIC rating page
 * (/survey/<token>) — no login required — carrying an unguessable token. The
 * submit action below is therefore intentionally unauthenticated: the token IS
 * the authorization. It is single-use and the rating is validated to the
 * SURVEY_RATING_MIN..SURVEY_RATING_MAX range.
 *
 * Token minting/lookup internals live in lib/csat-survey.ts (server-only, not
 * exposed as HTTP endpoints).
 */

export type SurveyState = { ok: true } | { error: string } | undefined;

/**
 * Public, unauthenticated submit. The token is the credential. One-time: once
 * respondedAt is set the survey is locked. Rating must be within
 * SURVEY_RATING_MIN..SURVEY_RATING_MAX; comment is optional. The write itself
 * is conditional on respondedAt still being null, so two concurrent submits
 * cannot both record a response (the loser gets "already-submitted").
 */
export async function submitSurvey(
  _prev: SurveyState,
  formData: FormData,
): Promise<SurveyState> {
  const token = String(formData.get("token") ?? "").trim();
  const rating = Number(formData.get("rating"));
  const comment = String(formData.get("comment") ?? "").trim().slice(0, 2000) || null;

  if (!token) return { error: "Invalid survey link." };
  if (!Number.isInteger(rating) || rating < SURVEY_RATING_MIN || rating > SURVEY_RATING_MAX) {
    return { error: "Please pick a rating." };
  }

  const survey = await db.surveyResponse.findUnique({
    where: { token },
    select: { respondedAt: true },
  });
  if (!survey) return { error: "This survey link is not valid." };
  if (survey.respondedAt) return { error: "already-submitted" };

  // Atomic single-use gate: only writes when no response exists yet; count===1
  // means THIS call won the race and its rating was recorded.
  const updated = await db.surveyResponse.updateMany({
    where: { token, respondedAt: null },
    data: { rating, comment, respondedAt: new Date() },
  });
  if (updated.count !== 1) return { error: "already-submitted" };
  return { ok: true };
}
