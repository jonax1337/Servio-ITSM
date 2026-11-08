"use client";

import "react-grid-layout/css/styles.css";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { GridLayout, useContainerWidth, type Layout } from "react-grid-layout";
import { GripVertical, Pencil, Trash2, Plus, Check, X, Loader2, Settings2, Trash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/combobox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { WidgetBody, widgetBodyOverflow, useWidgetTitle } from "@/components/dashboard/widget-card";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { WidgetConfigDialog, type EditorOptions } from "@/components/dashboard/widget-config-dialog";
import { ConfirmButton } from "@/components/confirm-dialog";
import { setDashboardLayout, updateDashboardSettings, deleteDashboard } from "@/lib/actions/dashboards";
import type { Widget, Computed } from "@/lib/dashboard/types";

export function DashboardCanvas({
  dashboardId,
  dashboardName,
  dashboardIsShared,
  dashboardGroupId,
  canManageShared,
  teams,
  initialWidgets,
  dataById,
  options,
}: {
  dashboardId: string;
  dashboardName: string;
  dashboardIsShared: boolean;
  dashboardGroupId: string | null;
  canManageShared: boolean;
  teams: { value: string; label: string }[];
  initialWidgets: Widget[];
  dataById: Record<string, Computed>;
  options: EditorOptions;
}) {
  const router = useRouter();
  const t = useT("dashboard");
  const widgetTitle = useWidgetTitle();
  const { width, containerRef, mounted } = useContainerWidth();
  const [widgets, setWidgets] = useState<Widget[]>(initialWidgets);
  // Live-computed data per widget (seeded from the server; refreshed on edit/add).
  const [dataMap, setDataMap] = useState<Record<string, Computed>>(dataById);
  const [configOpen, setConfigOpen] = useState(false);
  const [editing, setEditing] = useState<Widget | null>(null);
  const [saving, startSave] = useTransition();

  // Dashboard settings (name + sharing) — editable inline.
  const [name, setName] = useState(dashboardName);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sharing, setSharing] = useState(dashboardIsShared ? (dashboardGroupId ? "team" : "everyone") : "private");
  const [team, setTeam] = useState(dashboardGroupId ?? "none");
  const [savingSettings, startSettings] = useTransition();

  function saveSettings(fd: FormData) {
    startSettings(async () => {
      await updateDashboardSettings(fd);
      setSettingsOpen(false);
      router.refresh();
    });
  }

  const layout: Layout = widgets.map((w) => ({
    i: w.id,
    x: w.x,
    y: Number.isFinite(w.y) ? w.y : 0,
    w: w.w,
    h: w.h,
    minW: 2,
    minH: 1,
  }));

  function onLayoutChange(next: Layout) {
    setWidgets((ws) =>
      ws.map((w) => {
        const l = next.find((n) => n.i === w.id);
        return l ? { ...w, x: l.x, y: l.y, w: l.w, h: l.h } : w;
      }),
    );
  }

  function openAdd() {
    setEditing(null);
    setConfigOpen(true);
  }
  function openEdit(w: Widget) {
    setEditing(w);
    setConfigOpen(true);
  }
  function removeWidget(id: string) {
    setWidgets((ws) => ws.filter((w) => w.id !== id));
  }
  /** Recompute a single widget's data on the server for live preview (no save). */
  async function refresh(w: Widget) {
    try {
      const res = await fetch("/api/dashboard/widget", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(w),
      });
      const json = await res.json();
      if (json?.data) setDataMap((m) => ({ ...m, [w.id]: json.data as Computed }));
    } catch {
      /* keep whatever data we had */
    }
  }

  function saveWidget(w: Widget) {
    setWidgets((ws) => {
      const exists = ws.some((x) => x.id === w.id);
      if (exists) return ws.map((x) => (x.id === w.id ? { ...w, x: x.x, y: x.y, w: x.w, h: x.h } : x));
      // New widget → drop at the bottom.
      const bottom = ws.reduce((m, x) => Math.max(m, x.y + x.h), 0);
      return [...ws, { ...w, x: 0, y: bottom }];
    });
    // Live preview: fetch its real data immediately.
    void refresh(w);
  }

  function save() {
    const fd = new FormData();
    fd.set("id", dashboardId);
    fd.set("layout", JSON.stringify(widgets));
    startSave(async () => {
      await setDashboardLayout(fd);
      router.push(`/?dashboard=${dashboardId}`);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-3">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border bg-card/95 px-3 py-2 backdrop-blur">
        <span className="mr-auto text-sm font-medium">
          {t("editing")} <span className="text-muted-foreground">· {name}</span>
        </span>
        <Button type="button" variant="outline" size="sm" onClick={openAdd}>
          <Plus className="size-4" /> {t("addWidget")}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
          <Settings2 className="size-4" /> {t("settings")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => router.push(`/?dashboard=${dashboardId}`)} disabled={saving}>
          <X className="size-4" /> {t("cancel")}
        </Button>
        <Button type="button" size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} {t("save")}
        </Button>
      </div>

      <div ref={containerRef} className="min-h-[60vh]">
        {mounted && width > 0 ? (
          <GridLayout
            width={width}
            layout={layout}
            gridConfig={{ cols: 12, rowHeight: 120, margin: [16, 16], containerPadding: [0, 0] }}
            dragConfig={{ enabled: true, handle: ".rgl-drag-handle" }}
            resizeConfig={{ enabled: true, handles: ["se"] }}
            onLayoutChange={onLayoutChange}
          >
            {widgets.map((w) => (
              <div key={w.id} className="overflow-hidden rounded-xl border bg-card shadow-sm">
                <div className="flex items-center gap-1.5 border-b px-2.5 py-1.5">
                  <span className="rgl-drag-handle flex min-w-0 flex-1 cursor-move items-center gap-1.5">
                    <GripVertical className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm font-medium">{widgetTitle(w)}</span>
                    <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {t(`widget.${w.type}`)}
                    </span>
                  </span>
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => openEdit(w)} aria-label={t("editWidget")}>
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeWidget(w.id)} aria-label={t("removeWidget")} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <div className={cn("h-[calc(100%-2.5rem)] p-3", dataMap[w.id] ? widgetBodyOverflow(dataMap[w.id]) : "overflow-hidden")}>
                  {dataMap[w.id] ? (
                    <WidgetBody data={dataMap[w.id]} />
                  ) : (
                    <div className="grid h-full place-items-center text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </GridLayout>
        ) : null}
      </div>

      <WidgetConfigDialog
        open={configOpen}
        onOpenChange={setConfigOpen}
        initial={editing}
        options={options}
        onSave={saveWidget}
      />

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("dashboardSettings")}</DialogTitle>
            <DialogDescription>{canManageShared ? t("settingsDescriptionShared") : t("settingsDescription")}</DialogDescription>
          </DialogHeader>
          <form action={saveSettings} className="grid gap-3">
            <input type="hidden" name="id" value={dashboardId} />
            <div className="grid gap-1.5">
              <Label htmlFor="dash-settings-name">{t("name")}</Label>
              <Input id="dash-settings-name" name="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            {canManageShared ? (
              <>
                <input type="hidden" name="sharing" value={sharing} />
                <div className="grid gap-1.5">
                  <Label>{t("visibility")}</Label>
                  <Combobox
                    options={[
                      { value: "private", label: t("visibilityPrivate") },
                      { value: "team", label: t("shareWithTeam") },
                      { value: "everyone", label: t("everyone") },
                    ]}
                    value={sharing}
                    onChange={(v) => setSharing(v || "private")}
                  />
                </div>
                {sharing === "team" ? (
                  <Combobox
                    name="groupId"
                    options={[{ value: "none", label: t("chooseTeamEllipsis") }, ...teams]}
                    value={team}
                    onChange={(v) => setTeam(v || "none")}
                    searchPlaceholder={t("searchTeams")}
                  />
                ) : null}
              </>
            ) : null}
            <DialogFooter>
              <ConfirmButton
                action={async (fd) => {
                  await deleteDashboard(fd);
                  router.push("/");
                  router.refresh();
                }}
                fields={{ id: dashboardId }}
                title={t("deleteTitle")}
                description={t("deleteDescription")}
                confirmLabel={t("delete")}
                triggerVariant="ghost"
                triggerSize="default"
                triggerClassName="mr-auto text-muted-foreground hover:text-destructive"
              >
                <Trash className="size-4" /> {t("delete")}
              </ConfirmButton>
              <Button type="submit" disabled={!name.trim() || savingSettings}>
                {savingSettings ? <Loader2 className="size-4 animate-spin" /> : null} {t("saveSettings")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
