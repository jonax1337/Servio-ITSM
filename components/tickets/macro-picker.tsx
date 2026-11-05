"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Zap, Loader2, MessageSquareText, Share2, User as UserIcon } from "lucide-react";
import { applyMacro } from "@/lib/actions/macros";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type PickerMacro = {
  id: string;
  name: string;
  description: string | null;
  isShared: boolean;
  actionCount: number;
};

/**
 * Ticket-detail toolbar control: lists the macros available to the current agent
 * (their personal ones + any shared) and applies one to this ticket in a single
 * click. All authorization + validation lives in applyMacro on the server.
 */
export function MacroPicker({ ticketId, macros }: { ticketId: number; macros: PickerMacro[] }) {
  const [pending, startTransition] = useTransition();
  const [runningId, setRunningId] = useState<string | null>(null);

  const run = (macro: PickerMacro) => {
    setRunningId(macro.id);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("ticketId", String(ticketId));
      fd.set("macroId", macro.id);
      const res = await applyMacro(fd);
      setRunningId(null);
      if (res && "error" in res && res.error) {
        toast.error(res.error);
      } else {
        toast.success(`Applied "${macro.name}"`);
      }
    });
  };

  const shared = macros.filter((m) => m.isShared);
  const personal = macros.filter((m) => !m.isShared);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" disabled={pending} />}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />} Macros
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {macros.length === 0 ? (
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">
            No macros yet. Create one in Settings → Macros.
          </div>
        ) : (
          <>
            {shared.length > 0 ? (
              <DropdownMenuGroup>
                <DropdownMenuLabel className="flex items-center gap-1.5 text-xs">
                  <Share2 className="size-3.5" /> Shared
                </DropdownMenuLabel>
                {shared.map((m) => (
                  <MacroItem key={m.id} macro={m} running={runningId === m.id} disabled={pending} onRun={() => run(m)} />
                ))}
              </DropdownMenuGroup>
            ) : null}
            {shared.length > 0 && personal.length > 0 ? <DropdownMenuSeparator /> : null}
            {personal.length > 0 ? (
              <DropdownMenuGroup>
                <DropdownMenuLabel className="flex items-center gap-1.5 text-xs">
                  <UserIcon className="size-3.5" /> Personal
                </DropdownMenuLabel>
                {personal.map((m) => (
                  <MacroItem key={m.id} macro={m} running={runningId === m.id} disabled={pending} onRun={() => run(m)} />
                ))}
              </DropdownMenuGroup>
            ) : null}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MacroItem({
  macro, running, disabled, onRun,
}: {
  macro: PickerMacro;
  running: boolean;
  disabled: boolean;
  onRun: () => void;
}) {
  return (
    <DropdownMenuItem closeOnClick={false} disabled={disabled} onClick={onRun} className="items-start gap-2">
      {running ? (
        <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />
      ) : (
        <MessageSquareText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{macro.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {macro.description || `${macro.actionCount} action${macro.actionCount === 1 ? "" : "s"}`}
        </span>
      </span>
    </DropdownMenuItem>
  );
}
