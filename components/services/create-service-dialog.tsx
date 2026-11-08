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
import { ServiceForm } from "./service-form";
import { useT } from "@/lib/i18n/client";

export function CreateServiceDialog({
  options,
  size = "default",
}: {
  options: FormOptions;
  size?: "default" | "sm";
}) {
  const [open, setOpen] = useState(false);
  const t = useT("services");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size={size} />}>
        <Plus className="size-4" /> {t("newService")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("newService")}</DialogTitle>
          <DialogDescription>
            {t("newServiceDescription")}
          </DialogDescription>
        </DialogHeader>
        <ServiceForm options={options} />
      </DialogContent>
    </Dialog>
  );
}
