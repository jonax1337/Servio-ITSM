import { preflight } from "@/lib/api";
import { recordCommentHandlers } from "../../../_comments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export const { GET, POST } = recordCommentHandlers("Change");
