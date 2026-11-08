import { Eye, FilePen } from "lucide-react";
import { ToneBadge } from "@/components/status-badge";
import type { Meta } from "@/lib/constants";
import { getT } from "@/lib/i18n/server";

/** Whether portal users can see a status incident. Draft is amber so it never reads as published. */
export async function VisibilityBadge({ isPublic }: { isPublic: boolean }) {
  const t = await getT("status");
  const meta: Meta = isPublic
    ? { label: t("public"), tone: "info", icon: Eye }
    : { label: t("draft"), tone: "warning", icon: FilePen };
  return <ToneBadge meta={meta} />;
}
