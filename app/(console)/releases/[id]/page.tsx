import { canReadConsoleTitle } from "@/lib/metadata-access";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { getFormOptions } from "@/lib/data/options";
import { DetailShell, DetailTitle, DetailTopBar, MetaRow, RailCard } from "@/components/detail-layout";
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
  if (!(await canReadConsoleTitle())) return {};
  const releaseId = Number((await params).id);
  const release = Number.isFinite(releaseId)
    ? await db.release.findUnique({ where: { id: releaseId }, select: { name: true } })
    : null;
  if (release) return { title: release.name };
  const t = await getT("releases");
  return { title: t("detail.fallbackTitle") };
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

  const rail = (
    <RailCard title={tc("details")}>
      <MetaRow label={t("list.window")}>
        {window.start || window.end ? formatWindow(window, f, tch) : <span className="font-normal text-muted-foreground">{t("detail.windowHint")}</span>}
      </MetaRow>
      <MetaRow label={tc("owner")}>
        {release.owner ? (
          <span className="inline-flex items-center gap-2">
            <UserAvatar name={release.owner.name} email={release.owner.email} size="sm" />
            {release.owner.name ?? release.owner.email}
          </span>
        ) : (
          <span className="font-normal text-muted-foreground">{t("form.noOwner")}</span>
        )}
      </MetaRow>
      <MetaRow label={tc("group")}>{release.group?.name ?? <span className="font-normal text-muted-foreground">{tch("props.noGroup")}</span>}</MetaRow>
      {release.deployedAt ? <MetaRow label={t("detail.deployed")}>{f.date(release.deployedAt, "dateTime")}</MetaRow> : null}
      <MetaRow label={t("detail.lastUpdated")}>{f.date(release.updatedAt, "dateTime")}</MetaRow>
    </RailCard>
  );

  return (
    <DetailShell aside={rail}>
      <DetailTopBar
        backHref="/releases"
        backLabel={t("detail.back")}
        lead={<span className="font-mono text-sm text-muted-foreground">{releaseRef(release.id)}</span>}
      >
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
        <StatusBadge map={RELEASE_STATUS_META} value={release.status} />
      </DetailTopBar>

      <div className="grid content-start gap-4 p-4 sm:p-6">
        <div>
          <DetailTitle
            title={release.name}
            subtitle={
              <>
                {t("detail.created", { time: f.relative(release.createdAt) })}
                {release.owner ? <> · {t("detail.ownedBy", { name: release.owner.name ?? release.owner.email })}</> : null}
              </>
            }
          />
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
    </DetailShell>
  );
}
