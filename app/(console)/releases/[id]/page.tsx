import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { getFormOptions } from "@/lib/data/options";
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
  isBundleEditable,
  isReleaseFinished,
  releaseReadiness,
  releaseTransitionError,
  releaseWindow,
} from "@/lib/release-rules";
import type { ComboOption } from "@/components/combobox";
import { bundleLockedText } from "@/components/releases/release-text";
import { readinessText } from "@/components/releases/release-text";
import { formatWindow } from "@/components/changes/window-text";
import { getEnumT, getFormatter, getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const releaseId = Number((await params).id);
  const release = Number.isFinite(releaseId)
    ? await db.release.findUnique({ where: { id: releaseId }, select: { name: true } })
    : null;
  if (release) return { title: release.name };
  const t = await getT("releases");
  return { title: t("detail.fallbackTitle") };
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
  await requireRole("AGENT");
  const releaseId = Number((await params).id);
  if (!Number.isFinite(releaseId)) notFound();

  const [options, release] = await Promise.all([
    getFormOptions(),
    db.release.findUnique({
      where: { id: releaseId },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        group: true,
        changes: {
          select: { id: true, title: true, type: true, status: true, risk: true, plannedStart: true, plannedEnd: true },
          orderBy: { id: "asc" },
        },
      },
    }),
  ]);
  if (!release) notFound();
  const [t, tc, tch, te, f] = await Promise.all([getT("releases"), getT("common"), getT("changes"), getEnumT(), getFormatter()]);

  const readiness = releaseReadiness(release.changes);
  const window = releaseWindow(release.changes);
  const bundleEditable = isBundleEditable(release.status);
  const moves = allowedReleaseTransitions(release.status).map((status) => ({
    status,
    // The rule decides; the reason is worded in the viewer's language (moves are always allowed transitions).
    blockedReason: releaseTransitionError(release.status, status, release.changes)
      ? readiness.active === 0
        ? t("move.bundleFirst")
        : t("move.notApproved", { summary: readinessText(readiness, t) })
      : null,
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
    hint: te(CHANGE_STATUS_META, c.status),
  }));

  return (
    <div data-viewport-pane className="grid gap-0 lg:h-full lg:grid-cols-[1fr_320px] lg:overflow-hidden">
      {/* Main column — scrolls independently from the details rail, like a change */}
      <div className="min-w-0 border-b lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-6">
          <LinkButton href="/releases" variant="ghost" size="icon-sm" aria-label={t("detail.back")}>
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
              {t("detail.created", { time: f.relative(release.createdAt) })}
              {release.owner ? <> · {t("detail.ownedBy", { name: release.owner.name ?? release.owner.email })}</> : null}
            </p>
          </div>

          {release.description ? (
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{release.description}</p>
          ) : null}

          <ReleaseReadinessCard readiness={readiness} />

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-sm">{t("detail.changes", { count: release.changes.length })}</CardTitle>
              {bundleEditable ? (
                <LinkPicker
                  action={addChangeToReleaseAction}
                  triggerLabel={t("detail.addChange")}
                  title={t("detail.addChangeTitle")}
                  description={t("detail.addChangeDescription")}
                  hidden={{ releaseId: release.id }}
                  valueName="changeId"
                  options={candidateOptions}
                  placeholder={t("detail.chooseChange")}
                  searchPlaceholder={tch("list.searchPlaceholder")}
                  emptyText={t("detail.noCandidates")}
                  submitLabel={t("detail.addToRelease")}
                  successMessage={t("detail.added")}
                />
              ) : null}
            </CardHeader>
            <CardContent className={release.changes.length > 0 ? "px-0" : undefined}>
              {release.changes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {bundleEditable ? t("detail.emptyEditable") : t("detail.empty")}
                </p>
              ) : (
                <ReleaseChangesTable releaseId={release.id} changes={release.changes} editable={bundleEditable} />
              )}
              {!bundleEditable && release.changes.length > 0 ? (
                <p className="px-4 pt-3 text-xs text-muted-foreground">{bundleLockedText(release.status, t, te(RELEASE_STATUS_META, release.status))}</p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <aside className="grid content-start gap-4 p-4 sm:p-6 lg:min-h-0 lg:overflow-y-auto">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{tc("details")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Prop label={t("list.window")}>
              {window.start || window.end ? formatWindow(window, f, tch) : t("detail.windowHint")}
            </Prop>
            <Prop label={tc("owner")}>
              {release.owner ? (
                <span className="flex items-center gap-2">
                  <UserAvatar name={release.owner.name} email={release.owner.email} size="sm" />
                  {release.owner.name ?? release.owner.email}
                </span>
              ) : (
                <span className="text-muted-foreground">{t("form.noOwner")}</span>
              )}
            </Prop>
            <Prop label={tc("group")}>{release.group?.name ?? <span className="text-muted-foreground">{tch("props.noGroup")}</span>}</Prop>
            {release.deployedAt ? <Prop label={t("detail.deployed")}>{f.date(release.deployedAt, "dateTime")}</Prop> : null}
            <Prop label={t("detail.lastUpdated")}>{f.date(release.updatedAt, "dateTime")}</Prop>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
