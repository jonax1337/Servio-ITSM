import { createUIMessageStreamResponse } from "ai";
import { getActingAgent } from "@/lib/assistant-core";
import { stopRun, subscribeRun } from "@/lib/sable-active-runs";

type Params = { params: Promise<{ id: string }> };

/**
 * Rejoin a Sable answer that is still streaming (or just finished) in this
 * conversation: everything streamed so far, then the rest live. 204 when the
 * user has no run here — the AI SDK's "nothing to resume".
 */
export async function GET(_req: Request, { params }: Params) {
  const me = await getActingAgent();
  if (!me) return new Response("Not authorised", { status: 401 });
  const { id } = await params;
  const stream = subscribeRun(id, me.id);
  if (!stream) return new Response(null, { status: 204 });
  return createUIMessageStreamResponse({ stream });
}

/** The Stop button: cancel the user's running answer here (what was streamed so far is kept). */
export async function DELETE(_req: Request, { params }: Params) {
  const me = await getActingAgent();
  if (!me) return new Response("Not authorised", { status: 401 });
  const { id } = await params;
  return new Response(null, { status: stopRun(id, me.id) ? 204 : 404 });
}
