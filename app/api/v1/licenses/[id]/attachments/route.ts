import { preflight } from "@/lib/api";
import { attachmentCollectionHandlers } from "../../../_attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export const { GET, POST } = attachmentCollectionHandlers("licenses");
