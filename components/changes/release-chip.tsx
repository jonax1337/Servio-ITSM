import Link from "next/link";
import { Rocket } from "lucide-react";
import { db } from "@/lib/db";
import { getSessionUser, isAgent } from "@/lib/session";
import { StatusBadge } from "@/components/status-badge";
import { RELEASE_STATUS_META, releaseRef } from "@/lib/constants";

export type ReleaseChipProps = { changeId: number };

/** The release a change ships in, linked to it. Renders nothing for non-agents and for changes outside any release. */
export async function ReleaseChip({ changeId }: ReleaseChipProps) {
  const me = await getSessionUser();
  if (!me || !isAgent(me.role)) return null;

  const change = await db.change.findUnique({
    where: { id: changeId },
    select: { release: { select: { id: true, name: true, status: true } } },
  });
  const release = change?.release;
  if (!release) return null;

  return (
    <Link
      href={`/releases/${release.id}`}
      title={`${releaseRef(release.id)} ${release.name}`}
      className="inline-flex min-w-0 max-w-64 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1 text-xs transition-colors hover:border-primary/40"
    >
      <Rocket className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="shrink-0 font-mono text-muted-foreground">{releaseRef(release.id)}</span>
      <span className="truncate font-medium">{release.name}</span>
      <StatusBadge map={RELEASE_STATUS_META} value={release.status} dot={false} className="shrink-0" />
    </Link>
  );
}
