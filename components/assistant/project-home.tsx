"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  GitPullRequestArrow,
  Link2,
  Loader2,
  Settings,
  Ticket,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ConfirmButton } from "@/components/confirm-dialog";
import { Combobox, type ComboOption } from "@/components/combobox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LinkPicker } from "@/components/link-picker";
import { LinkedChip, UnlinkButton } from "@/components/linked-records";
import { ProjectFileBrowser } from "./project-file-browser";
import {
  getProject,
  renameProject,
  updateProjectInstructions,
  updateProjectBinding,
  shareProject,
  deleteProject,
  listMyTeams,
  getProjectLinks,
  type ProjectDetail,
  type TeamSummary,
  type ProjectLinks,
} from "@/lib/actions/ai-assistant";
import { useServerMessage, useT } from "@/lib/i18n/client";

/**
 * The Sable Project OVERVIEW — the empty-state body of a project-bound thread
 * (Harvey-vault style). Deliberately minimal: a header (name + ⚙ settings), the
 * file library, and linked ITSM records. The composer is the thread's own (docked
 * below); the project's chats live in the rail. Rename / instructions / sharing /
 * delete hide behind the settings dialog.
 */
export function ProjectHome({
  projectId,
  onChanged,
  onDeleted,
}: {
  projectId: string;
  /** Notify the shell after a mutation so rail labels refresh. */
  onChanged?: () => void;
  /** Called after the project is deleted so the shell can clear the active project. */
  onDeleted?: () => void;
}) {
  const t = useT("assistant");
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const load = useCallback(async () => {
    const res = await getProject(projectId);
    if (res.ok) {
      setProject(res.project);
      setNotFound(false);
    } else {
      setNotFound(true);
    }
  }, [projectId]);

  useEffect(() => {
    let ignore = false;
    getProject(projectId)
      .then((res) => {
        if (ignore) return;
        if (res.ok) setProject(res.project);
        else setNotFound(true);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [projectId]);

  if (loading) {
    return (
      <div className="grid flex-1 place-items-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound || !project) {
    return (
      <div className="grid flex-1 place-items-center p-6 text-center">
        <div className="max-w-xs space-y-1">
          <p className="text-sm font-medium">{t("project.unavailable")}</p>
          <p className="text-xs text-muted-foreground">
            {t("project.unavailableHint")}
          </p>
        </div>
      </div>
    );
  }

  const isOwner = project.role === "owner";

  return (
    <div className="space-y-6">
      {/* Header + Settings */}
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-xl font-semibold leading-tight tracking-tight">
            {project.name}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {isOwner ? t("project.youOwn") : t("project.sharedWithYou")}
            {project.isShared ? t("project.sharedWithTeam") : ""}
          </p>
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={() => setSettingsOpen(true)}
          aria-label={t("project.settings")}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <Settings className="size-4" />
        </Button>
      </div>

      <ProjectFileBrowser projectId={project.id} />

      <LinkedRecords project={project} isOwner={isOwner} onChanged={load} />

      <ProjectSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        project={project}
        isOwner={isOwner}
        onChanged={() => {
          void load();
          onChanged?.();
        }}
        onDeleted={onDeleted}
      />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Linked records — bound Ticket / Problem / Change, with a search-everything Link.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Project links — the SAME UI as ticket linking: a searchable LinkPicker per type
 * (Ticket / Problem / Change) plus LinkedChip pills with hover-unlink. Reuses the
 * shared components so there's exactly one linking look + search in the app.
 */
function LinkedRecords({
  project,
  isOwner,
  onChanged,
}: {
  project: ProjectDetail;
  isOwner: boolean;
  onChanged: () => void;
}) {
  const t = useT("assistant");
  const tm = useServerMessage();
  const [links, setLinks] = useState<ProjectLinks | null>(null);

  const reload = useCallback(async () => {
    const res = await getProjectLinks(project.id);
    if (res.ok) setLinks(res.links);
  }, [project.id]);

  useEffect(() => {
    // intentional: load linked records from the server on mount; the setState
    // happens only after the async fetch resolves inside reload().
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  async function bind(field: "ticketId" | "problemId" | "changeId", fd: FormData) {
    const raw = fd.get(field);
    const id = raw ? Number(raw) : null;
    if (!id) return;
    const res = await updateProjectBinding(project.id, { [field]: id });
    if (res.ok) {
      await reload();
      onChanged();
    } else {
      toast.error(res.error ? tm(res.error) : t("project.couldNotLink"));
    }
  }

  async function unbind(field: "ticketId" | "problemId" | "changeId") {
    const res = await updateProjectBinding(project.id, { [field]: null });
    if (res.ok) {
      await reload();
      onChanged();
    } else {
      toast.error(res.error ? tm(res.error) : t("project.couldNotUnlink"));
    }
  }

  const cur = links?.current;
  const hasAny = !!cur && !!(cur.ticket || cur.problem || cur.change);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Link2 className="size-4 text-muted-foreground" /> {t("project.linkedRecords")}
        </h2>
        {isOwner && links ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <LinkPicker
              action={(fd) => bind("ticketId", fd)}
              triggerLabel={t("project.ticket")}
              title={t("project.linkTicket")}
              description={t("project.linkTicketDescription")}
              hidden={{}}
              valueName="ticketId"
              options={links.options.tickets}
              placeholder={t("project.chooseTicket")}
              searchPlaceholder={t("project.searchTickets")}
              emptyText={t("project.noTickets")}
            />
            <LinkPicker
              action={(fd) => bind("problemId", fd)}
              triggerLabel={t("project.problem")}
              title={t("project.linkProblem")}
              description={t("project.linkProblemDescription")}
              hidden={{}}
              valueName="problemId"
              options={links.options.problems}
              placeholder={t("project.chooseProblem")}
              searchPlaceholder={t("project.searchProblems")}
              emptyText={t("project.noProblems")}
            />
            <LinkPicker
              action={(fd) => bind("changeId", fd)}
              triggerLabel={t("project.change")}
              title={t("project.linkChange")}
              description={t("project.linkChangeDescription")}
              hidden={{}}
              valueName="changeId"
              options={links.options.changes}
              placeholder={t("project.chooseChange")}
              searchPlaceholder={t("project.searchChanges")}
              emptyText={t("project.noChanges")}
            />
          </div>
        ) : null}
      </div>

      {hasAny && cur ? (
        <div className="flex flex-wrap gap-2">
          {cur.ticket ? (
            <LinkedChip
              href={cur.ticket.href}
              icon={<Ticket className="size-3.5 text-primary" />}
              label={cur.ticket.label}
              unlink={isOwner ? <UnlinkButton action={() => unbind("ticketId")} fields={{}} /> : undefined}
            />
          ) : null}
          {cur.problem ? (
            <LinkedChip
              href={cur.problem.href}
              icon={<AlertTriangle className="size-3.5 text-amber-500" />}
              label={cur.problem.label}
              unlink={isOwner ? <UnlinkButton action={() => unbind("problemId")} fields={{}} /> : undefined}
            />
          ) : null}
          {cur.change ? (
            <LinkedChip
              href={cur.change.href}
              icon={<GitPullRequestArrow className="size-3.5 text-primary" />}
              label={cur.change.label}
              unlink={isOwner ? <UnlinkButton action={() => unbind("changeId")} fields={{}} /> : undefined}
            />
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground/80">
          {isOwner
            ? t("project.linkHint")
            : t("project.noLinks")}
        </p>
      )}
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Settings dialog — rename, custom instructions, sharing, delete (owner-gated).
 * ──────────────────────────────────────────────────────────────────────────── */

function ProjectSettingsDialog({
  open,
  onOpenChange,
  project,
  isOwner,
  onChanged,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  project: ProjectDetail;
  isOwner: boolean;
  onChanged: () => void;
  onDeleted?: () => void;
}) {
  const t = useT("assistant");
  const tm = useServerMessage();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("project.settings")}</DialogTitle>
        </DialogHeader>
        {/* px so a focused field's ring isn't clipped — overflow-y-auto forces overflow-x:auto. */}
        <div className="max-h-[70vh] space-y-6 overflow-y-auto px-1">
          {isOwner ? <RenameField project={project} onChanged={onChanged} /> : null}
          <InstructionsEditor project={project} isOwner={isOwner} />
          {isOwner ? <SharingSection project={project} onChanged={onChanged} /> : null}
          {isOwner ? (
            <div className="border-t pt-4">
              <ConfirmButton
                action={async () => {
                  const res = await deleteProject(project.id);
                  if (res.ok) {
                    toast.success(t("project.deleted"));
                    onOpenChange(false);
                    onDeleted?.();
                    onChanged();
                  } else {
                    toast.error(res.error ? tm(res.error) : t("rail.couldNotDelete"));
                  }
                }}
                title={t("project.deleteTitle")}
                description={t("project.deleteDescription")}
                confirmLabel={t("project.delete")}
                triggerVariant="outline"
                triggerSize="sm"
                triggerClassName="text-destructive hover:text-destructive"
                triggerLabel={t("project.delete")}
              >
                <Trash2 className="size-3.5" /> {t("project.delete")}
              </ConfirmButton>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RenameField({ project, onChanged }: { project: ProjectDetail; onChanged: () => void }) {
  const t = useT("assistant");
  const tm = useServerMessage();
  const [name, setName] = useState(project.name);
  const [saving, setSaving] = useState(false);

  async function save() {
    const next = name.trim();
    if (!next || next === project.name) return;
    setSaving(true);
    const res = await renameProject(project.id, next);
    setSaving(false);
    if (res.ok) onChanged();
    else toast.error(res.error ? tm(res.error) : t("rail.couldNotRename"));
  }

  return (
    <section className="space-y-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t("project.name")}</span>
      <div className="flex items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            }
          }}
          maxLength={80}
        />
        {saving ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" /> : null}
      </div>
    </section>
  );
}

function InstructionsEditor({ project, isOwner }: { project: ProjectDetail; isOwner: boolean }) {
  const t = useT("assistant");
  const tm = useServerMessage();
  const [value, setValue] = useState(project.instructions ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(project.instructions ?? "");

  const save = useCallback(
    async (next: string) => {
      if (next === lastSaved.current) return;
      setStatus("saving");
      const res = await updateProjectInstructions(project.id, next);
      if (res.ok) {
        lastSaved.current = next;
        setStatus("saved");
        setTimeout(() => setStatus("idle"), 1500);
      } else {
        setStatus("idle");
        toast.error(res.error ? tm(res.error) : t("project.couldNotSaveInstructions"));
      }
    },
    [project.id, t, tm],
  );

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function onChange(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(next), 800);
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {t("project.instructions")}
        </span>
        {status === "saving" ? (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> {t("project.saving")}
          </span>
        ) : status === "saved" ? (
          <span className="flex items-center gap-1 text-[11px] text-sable">
            <Check className="size-3" /> {t("project.saved")}
          </span>
        ) : null}
      </div>
      {isOwner ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            if (timer.current) clearTimeout(timer.current);
            void save(value);
          }}
          placeholder={t("project.instructionsPlaceholder")}
          className="min-h-24 text-sm"
          maxLength={4000}
        />
      ) : project.instructions ? (
        <p className="whitespace-pre-wrap rounded-lg border bg-muted/30 px-3 py-2 text-sm text-foreground/90">
          {project.instructions}
        </p>
      ) : (
        <p className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground/70">
          {t("project.noInstructions")}
        </p>
      )}
    </section>
  );
}

function SharingSection({ project, onChanged }: { project: ProjectDetail; onChanged: () => void }) {
  const t = useT("assistant");
  const tm = useServerMessage();
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [teamId, setTeamId] = useState<string>(project.groupId ?? "");
  const [enabled, setEnabled] = useState(project.isShared);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let ignore = false;
    listMyTeams()
      .then((rows) => {
        if (!ignore) setTeams(rows);
      })
      .finally(() => {
        if (!ignore) setLoaded(true);
      });
    return () => {
      ignore = true;
    };
  }, []);

  const options: ComboOption[] = teams.map((team) => ({ value: team.id, label: team.name, icon: Users }));

  const apply = useCallback(
    async (nextEnabled: boolean, nextTeam: string) => {
      if (nextEnabled && !nextTeam) return; // wait until a team is picked
      setPending(true);
      const res = nextEnabled
        ? await shareProject(project.id, { isShared: true, groupId: nextTeam })
        : await shareProject(project.id, { isShared: false });
      setPending(false);
      if (res.ok) {
        toast.success(nextEnabled ? t("project.shared") : t("project.sharingOff"));
        onChanged();
      } else {
        toast.error(res.error ? tm(res.error) : t("project.couldNotUpdateSharing"));
      }
    },
    [project.id, onChanged, t, tm],
  );

  return (
    <section className="space-y-2">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {t("project.sharing")}
      </span>
      {loaded && teams.length === 0 ? (
        <p className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground/70">
          {t("project.noTeams")}
        </p>
      ) : (
        <div className="space-y-3">
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm">
              <span className="font-medium">{t("project.shareWithTeam")}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{t("project.shareHint")}</span>
            </span>
            <Switch
              checked={enabled}
              disabled={pending}
              onCheckedChange={(v) => {
                setEnabled(v);
                void apply(v, teamId);
              }}
            />
          </label>
          {enabled ? (
            <Combobox
              options={options}
              value={teamId}
              onChange={(v) => {
                setTeamId(v);
                void apply(true, v);
              }}
              placeholder={t("project.shareWithTeamPlaceholder")}
              searchPlaceholder={t("project.searchTeams")}
              emptyText={t("project.noTeamsFound")}
              size="sm"
            />
          ) : null}
        </div>
      )}
    </section>
  );
}
