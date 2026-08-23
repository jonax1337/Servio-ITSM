import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { checkAiRate } from "@/lib/rate-limit";
import { suggestTriage } from "@/lib/actions/ai";

/**
 * Triage as a route handler (not a server action) so the background analysis runs
 * concurrently and never blocks the agent's server actions (e.g. Save changes),
 * which Next.js serialises per client. Auth is enforced inside suggestTriage;
 * rate-limiting here (before the provider call) keyed by the session user.
 */
export async function GET(req: Request) {
  const id = Number(new URL(req.url).searchParams.get("ticketId"));
  if (!Number.isInteger(id)) {
    return NextResponse.json({ ok: false, error: "Bad ticket" }, { status: 400 });
  }
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ ok: false, error: "Not authorised" }, { status: 401 });
  const limited = checkAiRate(me.id);
  if (limited) {
    return NextResponse.json(
      { ok: false, error: "Too many AI requests — try again shortly." },
      { status: 429, headers: { "retry-after": String(Math.ceil(limited.retryAfterMs / 1000)) } },
    );
  }
  const res = await suggestTriage(id);
  return NextResponse.json(res);
}
