"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { FormOptions } from "@/lib/data/options";
import { ReleaseForm, type EditableRelease } from "./release-form";

export function ReleaseEditDialog({ release, options }: { release: EditableRelease; options: FormOptions }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Pencil className="size-4" /> Edit
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit release</DialogTitle>
        </DialogHeader>
        <ReleaseForm options={options} release={release} onSaved={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
