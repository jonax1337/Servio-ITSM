"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { GroupForm } from "./group-form";
import type { FormOptions } from "@/lib/data/options";
import { useT } from "@/lib/i18n/client";

export function CreateGroupDialog({
  options,
  size = "default",
}: {
  options: FormOptions;
  size?: "default" | "sm";
}) {
  const [open, setOpen] = useState(false);
  const t = useT("groups");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size={size} />}>
        <Plus className="size-4" /> {t("newGroup")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("newGroup")}</DialogTitle>
          <DialogDescription>
            {t("newGroupDescription")}
          </DialogDescription>
        </DialogHeader>
        <GroupForm options={options} />
      </DialogContent>
    </Dialog>
  );
}
