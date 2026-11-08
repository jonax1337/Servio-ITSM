import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Wrench } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { MaintenanceCountdown } from "@/components/maintenance/maintenance-countdown";
import { readMaintenanceFlag } from "@/lib/maintenance-flag";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("errors");
  return { title: t("maintenanceTitle") };
}
export const dynamic = "force-dynamic";

/** Shown by proxy.ts (a 503 rewrite) to everyone but admins while maintenance mode is on. */
export default async function MaintenancePage() {
  const maintenance = readMaintenanceFlag();
  if (!maintenance) redirect("/");
  const t = await getT("errors");

  return (
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden bg-sidebar p-6">
      <div className="absolute inset-0 bg-grid opacity-60" />
      <div className="absolute -left-24 top-1/3 size-[36rem] rounded-full bg-primary/20 blur-3xl" />
      <div className="relative grid w-full max-w-lg gap-8">
        <Wordmark />
        <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
          <div className="mb-5 grid size-11 place-items-center rounded-xl border bg-background text-primary">
            <Wrench className="size-5" aria-hidden />
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">{maintenance.title}</h1>
          <p className="mt-2 text-muted-foreground">
            {maintenance.message ??
              (maintenance.kind === "UPDATE" ? t("maintenanceUpdate") : t("maintenanceGeneral"))}
          </p>
          <MaintenanceCountdown endsAt={maintenance.endsAt} />
        </div>
      </div>
    </div>
  );
}
