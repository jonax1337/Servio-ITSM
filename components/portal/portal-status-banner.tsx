import Link from "next/link";
import { ArrowRight, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { listActivePublicIncidentHeads } from "@/lib/status-incidents";
import { worstImpact } from "@/lib/status-rules";
import { STATUS_INCIDENT_IMPACT_META, TONE_BANNER_CLASSES, TONE_TEXT_CLASSES, metaFor } from "@/lib/constants";
import { getT } from "@/lib/i18n/server";

/** Banner for active PUBLIC status incidents; renders nothing when all is well. */
export async function PortalStatusBanner() {
  const incidents = await listActivePublicIncidentHeads();
  if (incidents.length === 0) return null;
  const t = await getT("portal");

  const { tone } = metaFor(STATUS_INCIDENT_IMPACT_META, worstImpact(incidents.map((i) => i.impact)));
  const [latest] = incidents;
  const more = incidents.length - 1;

  return (
    <div role="status" className={cn("border-b", TONE_BANNER_CLASSES[tone])}>
      {/* The link spans the full strip so the hover tint covers the whole banner, not a centred box. */}
      <Link href="/portal/status" className="group block transition-colors hover:bg-foreground/[0.04]">
        <span className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-2.5 text-sm">
          <TriangleAlert className={cn("size-4 shrink-0", TONE_TEXT_CLASSES[tone])} />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">{latest.title}</span>
            {more > 0 ? (
              <span className="text-muted-foreground">
                {" "}
                {t("bannerMore", { count: more })}
              </span>
            ) : null}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-muted-foreground transition-colors group-hover:text-foreground">
            {t("bannerDetails")} <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </span>
      </Link>
    </div>
  );
}
