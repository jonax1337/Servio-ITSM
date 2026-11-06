import { Eye, FilePen } from "lucide-react";
import { ToneBadge } from "@/components/status-badge";
import type { Meta } from "@/lib/constants";

const PUBLIC_META: Meta = { label: "Public", tone: "info", icon: Eye };
const DRAFT_META: Meta = { label: "Draft", tone: "warning", icon: FilePen };

/** Whether portal users can see a status incident. Draft is amber so it never reads as published. */
export function VisibilityBadge({ isPublic }: { isPublic: boolean }) {
  return <ToneBadge meta={isPublic ? PUBLIC_META : DRAFT_META} />;
}
