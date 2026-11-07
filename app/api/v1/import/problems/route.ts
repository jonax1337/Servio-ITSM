import { preflight } from "@/lib/api";
import { importHandler } from "../../_import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** Import one historical problem with its thread (admin scope + ADMIN owner; see lib/api-import-input.ts). */
export const POST = importHandler("Problem");
