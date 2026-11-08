import Link from "next/link";
import { ArrowRight, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { listOpenWindows } from "@/lib/maintenance";
import { bannerFor } from "@/lib/maintenance-rules";
import { TONE_BANNER_CLASSES, TONE_TEXT_CLASSES } from "@/lib/constants";
import { LocalPeriod } from "@/components/maintenance/local-period";
import { getT } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translate";

const IN_PROGRESS = "Maintenance in progress: ";
const PLANNED = "Planned maintenance: ";

/** The fixed English sentences of bannerFor (lib/maintenance-rules.ts) in the viewer's language; window titles/messages stay as written. */
function localizeTitle(title: string, t: Translator<"maintenance">): string {
  if (title === "Maintenance mode is on") return t("modeOn");
  if (title.startsWith(IN_PROGRESS)) return t("inProgress", { title: title.slice(IN_PROGRESS.length) });
  if (title.startsWith(PLANNED)) return t("planned", { title: title.slice(PLANNED.length) });
  return title;
}

function localizeText(text: string, t: Translator<"maintenance">): string {
  if (text === "Users see the maintenance page.") return t("modeOnText");
  if (text === "Servio will be unavailable.") return t("unavailable");
  return text;
}

/** Announces a planned maintenance window ahead of time and, while one runs, tells the viewer what is going on. Renders nothing otherwise. */
export async function MaintenanceBanner({ role, containerClassName }: { role: string; containerClassName?: string }) {
  const banner = bannerFor(await listOpenWindows(), new Date(), role);
  if (!banner) return null;
  const t = await getT("maintenance");

  const content = (
    <span className={cn("flex w-full items-center gap-3 px-4 py-2.5 text-sm", containerClassName)}>
      <Wrench className={cn("size-4 shrink-0", TONE_TEXT_CLASSES[banner.tone])} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="font-medium">{localizeTitle(banner.title, t)}</span>{" "}
        <span className="text-muted-foreground">
          <LocalPeriod startsAt={banner.period.startsAt} endsAt={banner.period.endsAt} /> {localizeText(banner.text, t)}
        </span>
      </span>
      {banner.href ? (
        <span className="flex shrink-0 items-center gap-1 text-muted-foreground transition-colors group-hover:text-foreground">
          {t("details")} <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </span>
      ) : null}
    </span>
  );

  return (
    <div role="status" className={cn("border-b", TONE_BANNER_CLASSES[banner.tone])}>
      {banner.href ? (
        <Link href={banner.href} className="group block transition-colors hover:bg-foreground/[0.04]">
          {content}
        </Link>
      ) : (
        content
      )}
    </div>
  );
}
