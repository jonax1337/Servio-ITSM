import { preflight } from "@/lib/api";
import { attachmentItemHandlers } from "../../../../_attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export const { GET, DELETE } = attachmentItemHandlers("changes");
