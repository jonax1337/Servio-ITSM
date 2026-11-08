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
import type { FormOptions } from "@/lib/data/options";
import { ProblemForm } from "./problem-form";
import { useT } from "@/lib/i18n/client";

export function CreateProblemDialog({
  options,
  currentUserId,
  size = "default",
}: {
  options: FormOptions;
  currentUserId: string;
  size?: "default" | "sm";
}) {
  const [open, setOpen] = useState(false);
  const t = useT("problems");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size={size} />}>
        <Plus className="size-4" /> {t("new.title")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("new.title")}</DialogTitle>
          <DialogDescription>
            {t("new.description")}
          </DialogDescription>
        </DialogHeader>
        <ProblemForm options={options} currentUserId={currentUserId} />
      </DialogContent>
    </Dialog>
  );
}
