"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { ComboOption } from "@/components/combobox";
import { IncidentForm, type IncidentFormDefaults } from "@/components/status/incident-form";

export function EditIncidentDialog({
  incident,
  services,
  tickets,
  copyLocked,
}: {
  incident: IncidentFormDefaults;
  services: { id: string; name: string }[];
  tickets: ComboOption[];
  /** Public incident edited by a non-manager: the wording is read-only. */
  copyLocked: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Pencil className="size-4" /> Edit
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit status incident</DialogTitle>
          <DialogDescription>To change the state, post an update instead.</DialogDescription>
        </DialogHeader>
        <IncidentForm incident={incident} services={services} tickets={tickets} canPublish={false} copyLocked={copyLocked} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
