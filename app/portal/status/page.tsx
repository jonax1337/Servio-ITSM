import type { Metadata } from "next";
import { Activity, CheckCircle2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { requireUser } from "@/lib/session";
import { listPublicIncidents } from "@/lib/status-incidents";
import { worstImpact } from "@/lib/status-rules";
import { PublicIncidentCard } from "@/components/status/public-incident-card";
import {
  STATUS_INCIDENT_IMPACT_META,
  TONE_BANNER_CLASSES,
  TONE_TEXT_CLASSES,
  metaFor,
} from "@/lib/constants";

export const metadata: Metadata = { title: "Status" };
export const dynamic = "force-dynamic";

const ACTIVE_LIMIT = 20;
const HISTORY_SIZE = 10;

export default async function PortalStatusPage() {
  const user = await requireUser();
  const [active, history] = await Promise.all([
    listPublicIncidents(user.id, "active", ACTIVE_LIMIT),
    listPublicIncidents(user.id, "history", HISTORY_SIZE),
  ]);
  const { tone } = metaFor(STATUS_INCIDENT_IMPACT_META, worstImpact(active.map((i) => i.impact)));

  return (
    <div className="mx-auto grid max-w-3xl gap-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Service status</h1>
        <p className="mt-1 text-muted-foreground">Known issues and recent incidents, updated by the Service Desk.</p>
      </div>

      {active.length === 0 ? (
        <div className={cn("flex items-center gap-3 rounded-xl border p-4 sm:p-5", TONE_BANNER_CLASSES.success)}>
          <CheckCircle2 className={cn("size-5 shrink-0", TONE_TEXT_CLASSES.success)} />
          <div>
            <p className="font-medium">All systems operational</p>
            <p className="text-sm text-muted-foreground">There are no known issues right now.</p>
          </div>
        </div>
      ) : (
        <section aria-labelledby="active-incidents" className="grid gap-4">
          <div className={cn("flex items-center gap-3 rounded-xl border p-4 sm:p-5", TONE_BANNER_CLASSES[tone])}>
            <TriangleAlert className={cn("size-5 shrink-0", TONE_TEXT_CLASSES[tone])} />
            <div>
              <h2 id="active-incidents" className="font-medium">
                {active.length === 1 ? "We are working on an issue" : `We are working on ${active.length} issues`}
              </h2>
              <p className="text-sm text-muted-foreground">Some services may be slow or unavailable. This page updates as we learn more.</p>
            </div>
          </div>
          {active.map((incident) => (
            <PublicIncidentCard key={incident.id} incident={incident} />
          ))}
        </section>
      )}

      {history.length > 0 ? (
        <section aria-labelledby="past-incidents" className="grid gap-4">
          <h2 id="past-incidents" className="flex items-center gap-2 font-medium">
            <Activity className="size-4 text-muted-foreground" /> Recently resolved
          </h2>
          {history.map((incident) => (
            <PublicIncidentCard key={incident.id} incident={incident} variant="history" />
          ))}
        </section>
      ) : null}
    </div>
  );
}
