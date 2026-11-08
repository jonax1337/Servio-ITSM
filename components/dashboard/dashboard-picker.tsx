"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Users, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboOption } from "@/components/combobox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { createDashboard } from "@/lib/actions/dashboards";
import { useT } from "@/lib/i18n/client";

export type DashboardRow = {
  id: string;
  name: string;
  isShared: boolean;
  ownerId: string;
  groupId: string | null;
  owner: { name: string | null; email: string };
};

export function DashboardPicker({
  dashboards,
  activeId,
  currentUserId,
  canManageShared,
  teams,
}: {
  dashboards: DashboardRow[];
  activeId: string;
  currentUserId: string;
  canManageShared: boolean;
  teams: { value: string; label: string }[];
}) {
  const router = useRouter();
  const t = useT("dashboard");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [team, setTeam] = useState("none");
  const [pending, start] = useTransition();

  const options: ComboOption[] = dashboards.map((d) => ({
    value: d.id,
    // The auto-created personal dashboard keeps its stored English name; show it translated.
    label: d.name === "My Dashboard" && !d.isShared && d.ownerId === currentUserId ? t("myDashboard") : d.name,
    icon: d.isShared ? Users : LayoutDashboard,
    hint: d.isShared ? (d.groupId ? t("pickerTeam") : t("pickerShared")) : undefined,
  }));

  function submitCreate(fd: FormData) {
    start(async () => {
      const id = await createDashboard(fd);
      setOpen(false);
      setName("");
      setShared(false);
      setTeam("none");
      if (id) router.push(`/?dashboard=${id}`);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Combobox
        options={options}
        value={activeId}
        onChange={(v) => v && router.push(`/?dashboard=${v}`)}
        placeholder={t("selectDashboard")}
        searchPlaceholder={t("searchDashboards")}
        size="sm"
        className="w-auto min-w-[13rem]"
      />
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> {t("newDashboard")}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("newDashboard")}</DialogTitle>
            <DialogDescription>{t("newDashboardDescription")}</DialogDescription>
          </DialogHeader>
          <form action={submitCreate} className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="dash-name">{t("name")}</Label>
              <Input
                id="dash-name"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("namePlaceholder")}
                autoFocus
                required
              />
            </div>
            {canManageShared ? (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox name="isShared" checked={shared} onCheckedChange={(v) => setShared(!!v)} />
                  {t("shareWithTeam")}
                </label>
                {shared ? (
                  <Combobox
                    name="groupId"
                    options={[{ value: "none", label: t("everyone") }, ...teams]}
                    value={team}
                    onChange={(v) => setTeam(v || "none")}
                    placeholder={t("chooseTeam")}
                    searchPlaceholder={t("searchTeams")}
                  />
                ) : null}
              </>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={!name.trim() || pending}>{t("createDashboard")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
