import Link from "next/link";
import { ArrowRight, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { listOpenWindows } from "@/lib/maintenance";
import { bannerFor } from "@/lib/maintenance-rules";
import { TONE_BANNER_CLASSES, TONE_TEXT_CLASSES } from "@/lib/constants";
import { LocalPeriod } from "@/components/maintenance/local-period";

/** Announces a planned maintenance window ahead of time and, while one runs, tells the viewer what is going on. Renders nothing otherwise. */
export async function MaintenanceBanner({ role, containerClassName }: { role: string; containerClassName?: string }) {
  const banner = bannerFor(await listOpenWindows(), new Date(), role);
  if (!banner) return null;

  const content = (
    <span className={cn("flex w-full items-center gap-3 px-4 py-2.5 text-sm", containerClassName)}>
      <Wrench className={cn("size-4 shrink-0", TONE_TEXT_CLASSES[banner.tone])} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="font-medium">{banner.title}</span>{" "}
        <span className="text-muted-foreground">
          <LocalPeriod startsAt={banner.period.startsAt} endsAt={banner.period.endsAt} /> {banner.text}
        </span>
      </span>
      {banner.href ? (
        <span className="flex shrink-0 items-center gap-1 text-muted-foreground transition-colors group-hover:text-foreground">
          Details <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
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
