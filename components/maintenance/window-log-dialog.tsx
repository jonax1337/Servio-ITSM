"use client";

import { format } from "date-fns";
import { ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/status-badge";
import { UPDATER_STATE_META } from "@/lib/constants";
import type { UpdaterLogEntry } from "@/lib/maintenance-rules";

const LOG_TIME = "PP pp";

const formatLogTime = (at: string): string => (Number.isNaN(Date.parse(at)) ? at : format(new Date(at), LOG_TIME));

/** The updater's step-by-step log of a maintenance window, plus its final result. */
export function WindowLogDialog({ title, result, log }: { title: string; result: string | null; log: UpdaterLogEntry[] }) {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="sm" className="gap-1" />}>
        <ScrollText className="size-3.5" /> Log
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{result ?? "No result reported yet."}</DialogDescription>
        </DialogHeader>
        {log.length === 0 ? (
          <p className="text-sm text-muted-foreground">The updater has not logged any steps.</p>
        ) : (
          <ol className="grid max-h-80 gap-2 overflow-y-auto text-sm">
            {log.map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="grid gap-0.5 rounded-lg border p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <StatusBadge map={UPDATER_STATE_META} value={entry.state} />
                  <span className="text-xs tabular-nums text-muted-foreground">{formatLogTime(entry.at)}</span>
                </div>
                <p>{entry.message}</p>
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
