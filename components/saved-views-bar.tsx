"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Bookmark, BookmarkPlus, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/combobox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { createSavedView, deleteSavedView } from "@/lib/actions/saved-views";
import { useT } from "@/lib/i18n/client";

export type SavedViewRow = {
  id: string;
  name: string;
  filters: string; // JSON
  isShared: boolean;
  ownerId: string;
  groupId: string | null;
  owner: { name: string | null; email: string };
};

/**
 * A row of saved filter "views" for a list page. Applying a view navigates with
 * its stored filter params; "Save view" captures the CURRENT filters. Managers can
 * publish a view to a team (shared); everyone can keep personal views.
 */
export function SavedViewsBar({
  entity,
  basePath,
  filterKeys,
  views,
  currentUserId,
  canManageShared,
  teams,
}: {
  entity: string;
  basePath: string;
  filterKeys: readonly string[];
  views: SavedViewRow[];
  currentUserId: string;
  canManageShared: boolean;
  teams: { value: string; label: string }[];
}) {
  const sp = useSearchParams();
  const t = useT("components");

  // Current filter params (only the keys that define a view).
  const current: Record<string, string> = {};
  for (const k of filterKeys) {
    const v = sp.get(k);
    if (v && v !== "all") current[k] = v;
  }
  const hasFilters = Object.keys(current).length > 0;

  const hrefFor = (filters: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) p.set(k, v);
    const qs = p.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const same = (a: Record<string, string>, b: Record<string, string>) => {
    const ak = Object.keys(a);
    return ak.length === Object.keys(b).length && ak.every((k) => a[k] === b[k]);
  };

  const parsed = views.map((v) => {
    let f: Record<string, string> = {};
    try {
      f = JSON.parse(v.filters);
    } catch {
      f = {};
    }
    return { ...v, f };
  });
  const activeId =
    parsed.find((v) => same(v.f, current))?.id ??
    (hasFilters ? null : "__all__");

  const chip = (active: boolean) =>
    cn(
      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
      active
        ? "border-primary/40 bg-primary/10 text-primary"
        : "text-muted-foreground hover:border-primary/40 hover:text-foreground",
    );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Link href={basePath} className={chip(activeId === "__all__")}>
        <Bookmark className="size-3.5" /> {t("views.all")}
      </Link>

      {parsed.map((v) => (
        <span key={v.id} className="group/view inline-flex items-center">
          <Link href={hrefFor(v.f)} className={chip(activeId === v.id)}>
            {v.isShared ? <Users className="size-3.5 opacity-70" /> : null}
            {v.name}
          </Link>
          {v.ownerId === currentUserId || canManageShared ? (
            <ConfirmButton
              action={deleteSavedView}
              fields={{ id: v.id }}
              title={t("views.deleteTitle")}
              description={t("views.deleteDescription", { name: v.name })}
              triggerVariant="ghost"
              triggerSize="icon-xs"
              triggerClassName="-ml-1 size-5 rounded-full text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover/view:opacity-100"
              triggerLabel={t("views.deleteLabel", { name: v.name })}
            >
              <X className="size-3" />
            </ConfirmButton>
          ) : null}
        </span>
      ))}

      <SaveViewButton
        entity={entity}
        filters={current}
        hasFilters={hasFilters}
        canManageShared={canManageShared}
        teams={teams}
      />
    </div>
  );
}

function SaveViewButton({
  entity,
  filters,
  hasFilters,
  canManageShared,
  teams,
}: {
  entity: string;
  filters: Record<string, string>;
  hasFilters: boolean;
  canManageShared: boolean;
  teams: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [team, setTeam] = useState("none");
  const t = useT("components");

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-xs text-muted-foreground"
        onClick={() => setOpen(true)}
        disabled={!hasFilters}
        title={hasFilters ? t("views.saveHint") : t("views.applyFilterFirst")}
      >
        <BookmarkPlus className="size-3.5" /> {t("views.save")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("views.save")}</DialogTitle>
            <DialogDescription>{t("views.saveDescription")}</DialogDescription>
          </DialogHeader>
          <form
            action={async (fd) => {
              await createSavedView(fd);
              setOpen(false);
              setName("");
              setShared(false);
              setTeam("none");
            }}
            className="grid gap-3"
          >
            <input type="hidden" name="entity" value={entity} />
            <input type="hidden" name="filters" value={JSON.stringify(filters)} />
            <div className="grid gap-1.5">
              <Label htmlFor="view-name">{t("views.name")}</Label>
              <Input
                id="view-name"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("views.namePlaceholder")}
                autoFocus
                required
              />
            </div>
            {canManageShared ? (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox name="isShared" checked={shared} onCheckedChange={(v) => setShared(!!v)} />
                  {t("views.shareWithTeam")}
                </label>
                {shared ? (
                  <Combobox
                    name="groupId"
                    options={[{ value: "none", label: t("views.everyone") }, ...teams]}
                    value={team}
                    onChange={(v) => setTeam(v || "none")}
                    placeholder={t("views.chooseTeam")}
                    searchPlaceholder={t("views.searchTeams")}
                  />
                ) : null}
              </>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={!name.trim()}>{t("views.save")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
