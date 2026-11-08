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
import { CategoryForm } from "./category-form";
import { useT } from "@/lib/i18n/client";

type Parent = { id: string; name: string };
type Team = { id: string; name: string };

export function CreateCategoryDialog({
  parents,
  teams,
  size = "default",
}: {
  parents: Parent[];
  teams: Team[];
  size?: "default" | "sm";
}) {
  const [open, setOpen] = useState(false);
  const t = useT("categories");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size={size} />}>
        <Plus className="size-4" /> {t("new.title")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("new.title")}</DialogTitle>
          <DialogDescription>
            {t("new.description")}
          </DialogDescription>
        </DialogHeader>
        <CategoryForm parents={parents} teams={teams} />
      </DialogContent>
    </Dialog>
  );
}
