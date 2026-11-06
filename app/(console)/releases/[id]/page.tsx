import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { db } from "@/lib/db";
import { getFormOptions } from "@/lib/data/options";
import { formatPlannedWindow } from "@/lib/change-rules";
import { LinkButton } from "@/components/link-button";
import { LinkPicker } from "@/components/link-picker";
import { StatusBadge } from "@/components/status-badge";
import { UserAvatar } from "@/components/user-avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReleaseChangesTable } from "@/components/releases/release-changes-table";
import { ReleaseEditDialog } from "@/components/releases/release-edit-dialog";
import { ReleaseReadinessCard } from "@/components/releases/release-readiness-card";
import { ReleaseStatusActions } from "@/components/releases/release-status-actions";
import { addChangeToReleaseAction } from "@/lib/actions/releases";
import { CHANGE_STATUS_META, RELEASE_STATUS_META, changeRef, releaseRef } from "@/lib/constants";
import {
  allowedReleaseTransitions,
  bundleLockedMessage,
  isBundleEditable,
  isReleaseFinished,
  releaseReadiness,
  releaseTransitionError,
  releaseWindow,
} from "@/lib/release-rules";
import type { ComboOption } from "@/components/combobox";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const releaseId = Number((await params).id);
  if (!Number.isFinite(releaseId)) return { title: "Release" };
  const release = await db.release.findUnique({ where: { id: releaseId }, select: { name: true } });
  return { title: release?.name ?? "Release" };
}

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="text-sm">{children}</div>
    </div>
  );
}

export default async function ReleaseDetailPage({ params }: { params: Params }) {
  const releaseId = Number((await params).id);
  if (!Number.isFinite(releaseId)) notFound();

  const [options, release] = await Promise.all([
    getFormOptions(),
    db.release.findUnique({
      where: { id: releaseId },
      include: {
        owner: true,
        group: true,
        changes: {
          select: { id: true, title: true, type: true, status: true, risk: true, plannedStart: true, plannedEnd: true },
          orderBy: { id: "asc" },
        },
      },
    }),
  ]);
  if (!release) notFound();

  const readiness = releaseReadiness(release.changes);
  const window = releaseWindow(release.changes);
  const bundleEditable = isBundleEditable(release.status);
  const moves = allowedReleaseTransitions(release.status).map((status) => ({
    status,
    blockedReason: releaseTransitionError(release.status, status, release.changes),
  }));

  const candidates = bundleEditable
    ? await db.change.findMany({
        where: { releaseId: null, status: { notIn: ["CLOSED", "CANCELLED"] } },
        select: { id: true, title: true, status: true },
        orderBy: { updatedAt: "desc" },
        take: 200,
      })
    : [];
  const candidateOptions: ComboOption[] = candidates.map((c) => ({
    value: String(c.id),
    label: `${changeRef(c.id)} · ${c.title}`,
    hint: CHANGE_STATUS_META[c.status]?.label,
  }));

  return (
    <div className="grid gap-0 lg:h-[calc(100svh-3.5rem)] lg:grid-cols-[1fr_320px] lg:overflow-hidden">
      {/* Main column — scrolls independently from the details rail, like a change */}
      <div className="min-w-0 border-b lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-6">
          <LinkButton href="/releases" variant="ghost" size="icon-sm" aria-label="Back to releases">
            <ArrowLeft className="size-4" />
          </LinkButton>
          <span className="font-mono text-sm text-muted-foreground">{releaseRef(release.id)}</span>
          <StatusBadge map={RELEASE_STATUS_META} value={release.status} />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <ReleaseStatusActions releaseId={release.id} moves={moves} />
            {isReleaseFinished(release.status) ? null : (
              <ReleaseEditDialog
                release={{
                  id: release.id,
                  name: release.name,
                  description: release.description,
                  ownerId: release.ownerId,
                  groupId: release.groupId,
                }}
                options={options}
              />
            )}
          </div>
        </div>

        <div className="grid content-start gap-4 p-4 sm:p-6">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">{release.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Created {formatDistanceToNow(release.createdAt, { addSuffix: true })}
              {release.owner ? <> · owned by {release.owner.name ?? release.owner.email}</> : null}
            </p>
          </div>

          {release.description ? (
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{release.description}</p>
          ) : null}

          <ReleaseReadinessCard readiness={readiness} />

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-sm">Changes ({release.changes.length})</CardTitle>
              {bundleEditable ? (
                <LinkPicker
                  action={addChangeToReleaseAction}
                  triggerLabel="Add change"
                  title="Add a change to this release"
                  description="Only changes that are not part of another release are listed."
                  hidden={{ releaseId: release.id }}
                  valueName="changeId"
                  options={candidateOptions}
                  placeholder="Choose a change…"
                  searchPlaceholder="Search changes…"
                  emptyText="Every open change already ships in a release."
                  submitLabel="Add to release"
                  successMessage="Change added to the release"
                />
              ) : null}
            </CardHeader>
            <CardContent className={release.changes.length > 0 ? "px-0" : undefined}>
              {release.changes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {bundleEditable ? "No changes bundled yet. Add the changes that ship together." : "No changes were bundled."}
                </p>
              ) : (
                <ReleaseChangesTable releaseId={release.id} changes={release.changes} editable={bundleEditable} />
              )}
              {!bundleEditable && release.changes.length > 0 ? (
                <p className="px-4 pt-3 text-xs text-muted-foreground">{bundleLockedMessage(release.status)}</p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <aside className="grid content-start gap-4 p-4 sm:p-6 lg:min-h-0 lg:overflow-y-auto">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Prop label="Window">
              {window.start || window.end ? formatPlannedWindow(window) : "Set by the planned windows of the bundled changes"}
            </Prop>
            <Prop label="Owner">
              {release.owner ? (
                <span className="flex items-center gap-2">
                  <UserAvatar name={release.owner.name} email={release.owner.email} size="sm" />
                  {release.owner.name ?? release.owner.email}
                </span>
              ) : (
                <span className="text-muted-foreground">No owner</span>
              )}
            </Prop>
            <Prop label="Group">{release.group?.name ?? <span className="text-muted-foreground">No group</span>}</Prop>
            {release.deployedAt ? <Prop label="Deployed">{format(release.deployedAt, "PP p")}</Prop> : null}
            <Prop label="Last updated">{format(release.updatedAt, "PP p")}</Prop>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
