import { preflight } from "@/lib/api";
import { reimportHandler } from "../../../_import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** Create or bring up to date one imported ticket by its import_ref (update mode; admin scope + ADMIN owner). */
export const PUT = reimportHandler("Ticket");
