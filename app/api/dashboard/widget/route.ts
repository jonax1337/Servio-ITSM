import { NextResponse } from "next/server";
import { getCurrentUser, isAgent, type Role } from "@/lib/session";
import { computeWidget } from "@/lib/dashboard/compute";
import type { Widget, WidgetType } from "@/lib/dashboard/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: WidgetType[] = ["stat", "breakdown", "volume", "sla", "aging", "list"];

/**
 * Compute a single widget's data on demand — powers the dashboard editor's live
 * preview (no save needed). Agent-gated; only reads, and filters map to fixed
 * ticket columns so there's nothing to inject.
 */
export async function POST(req: Request) {
  // DB-truth guard: the JWT freezes role/isActive at login, so a deactivated or
  // demoted user must not keep widget access until token expiry.
  const me = await getCurrentUser();
  if (!me || !me.isActive || !isAgent(me.role as Role)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const w = body as Partial<Widget>;
  if (!w || !TYPES.includes(w.type as WidgetType)) {
    return NextResponse.json({ error: "bad widget" }, { status: 400 });
  }
  const widget: Widget = {
    id: String(w.id ?? "preview"),
    type: w.type as WidgetType,
    title: String(w.title ?? ""),
    filters: (w.filters && typeof w.filters === "object" ? w.filters : {}) as Widget["filters"],
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    options: w.options,
  };
  const data = await computeWidget(widget);
  return NextResponse.json({ data });
}
