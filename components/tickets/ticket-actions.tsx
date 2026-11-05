"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Eye, EyeOff, ChevronsUp, Flame, Link2, GitMerge, MoreHorizontal, UserPlus,
} from "lucide-react";
import {
  escalateTicket, toggleMajorIncident, toggleWatch, linkTicket, mergeTicket, addParticipant,
} from "@/lib/actions/tickets";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Combobox, type ComboOption } from "@/components/combobox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Candidate = { value: string; label: string };

/** Typed-result actions surface failures as toasts instead of silently no-oping. */
async function runToggleWatch(fd: FormData): Promise<void> {
  const res = await toggleWatch(fd);
  if (res && !res.ok) toast.error(res.error ?? "Could not update watch.");
}

async function runEscalateTicket(fd: FormData): Promise<void> {
  const res = await escalateTicket(fd);
  if (res && !res.ok) toast.error(res.error ?? "Could not escalate.");
}

// A successful merge redirects to the target ticket; only a refusal comes back here.
async function runMergeTicket(fd: FormData): Promise<void> {
  const res = await mergeTicket(fd);
  if (res && !res.ok) toast.error(res.error ?? "Could not merge the ticket.");
}

const LINK_TYPES: ComboOption[] = [
  { value: "RELATED", label: "Related to", tone: "info" },
  { value: "DUPLICATE", label: "Duplicate of", tone: "warning" },
  { value: "BLOCKS", label: "Blocks", tone: "danger" },
  { value: "CAUSED_BY", label: "Caused by", tone: "purple" },
];

export function TicketActions({
  ticketId, isWatching, isMajorIncident, candidates, watchers = [], people = [],
}: {
  ticketId: number;
  isWatching: boolean;
  isMajorIncident: boolean;
  candidates: Candidate[];
  watchers?: string[];
  people?: Candidate[];
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [participantOpen, setParticipantOpen] = useState(false);
  const [linkTarget, setLinkTarget] = useState<string>("");
  const [linkType, setLinkType] = useState("RELATED");
  const [mergeTarget, setMergeTarget] = useState<string>("");
  const [participantTarget, setParticipantTarget] = useState<string>("");
  const opts: ComboOption[] = candidates;
  const peopleOpts: ComboOption[] = people;

  return (
    <>
      {/* Watch (hover shows who's watching) */}
      <Tooltip>
        <TooltipTrigger
          render={
            <form action={runToggleWatch}>
              <input type="hidden" name="id" value={ticketId} />
              <Button type="submit" variant={isWatching ? "secondary" : "outline"} size="sm">
                {isWatching ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                {isWatching ? "Watching" : "Watch"}
                {watchers.length > 0 ? <span className="ml-0.5 opacity-70">· {watchers.length}</span> : null}
              </Button>
            </form>
          }
        />
        <TooltipContent>
          {watchers.length > 0 ? (
            <div className="grid gap-0.5">
              <span className="text-xs font-medium">Watching this ticket</span>
              {watchers.slice(0, 8).map((w) => (
                <span key={w} className="text-xs text-muted-foreground">{w}</span>
              ))}
            </div>
          ) : (
            <span className="text-xs">No one is watching yet</span>
          )}
        </TooltipContent>
      </Tooltip>

      {/* Actions menu */}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
          <MoreHorizontal className="size-4" /> Actions
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <form action={runEscalateTicket}>
            <input type="hidden" name="id" value={ticketId} />
            <DropdownMenuItem nativeButton closeOnClick={false} render={<button type="submit" className="w-full" />}>
              <ChevronsUp className="size-4" /> Escalate priority
            </DropdownMenuItem>
          </form>
          <form action={toggleMajorIncident}>
            <input type="hidden" name="id" value={ticketId} />
            <DropdownMenuItem
              nativeButton
              closeOnClick={false}
              variant={isMajorIncident ? "default" : "destructive"}
              render={<button type="submit" className="w-full" />}
            >
              <Flame className="size-4" />
              {isMajorIncident ? "Clear Major Incident" : "Declare Major Incident"}
            </DropdownMenuItem>
          </form>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setParticipantOpen(true)}>
            <UserPlus className="size-4" /> Add participant…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setLinkOpen(true)}>
            <Link2 className="size-4" /> Link ticket…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setMergeOpen(true)}>
            <GitMerge className="size-4" /> Merge into…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Add participant — notify someone without an @mention */}
      <Dialog open={participantOpen} onOpenChange={setParticipantOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add participant</DialogTitle>
            <DialogDescription>Add someone to this ticket and notify them — no @mention needed.</DialogDescription>
          </DialogHeader>
          <form action={async (fd) => { await addParticipant(fd); setParticipantOpen(false); setParticipantTarget(""); }} className="grid gap-3">
            <input type="hidden" name="ticketId" value={ticketId} />
            <Combobox options={peopleOpts} value={participantTarget} onChange={setParticipantTarget} name="userId" placeholder="Choose a person" searchPlaceholder="Search people…" />
            <Textarea name="note" placeholder="Optional note for them…" className="min-h-16" />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox name="notifyByEmail" /> Also send them an email
            </label>
            <DialogFooter>
              <Button type="submit" disabled={!participantTarget}>Add participant</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Link dialog */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Link ticket</DialogTitle>
            <DialogDescription>Connect this ticket to another related ticket.</DialogDescription>
          </DialogHeader>
          <form
            action={async (fd) => {
              const res = await linkTicket(fd);
              if (!res.ok) {
                toast.error(res.error ?? "Could not link ticket.");
                return;
              }
              toast.success("Ticket linked");
              setLinkOpen(false);
              setLinkTarget("");
            }}
            className="grid gap-3"
          >
            <input type="hidden" name="id" value={ticketId} />
            <Combobox name="type" options={LINK_TYPES} value={linkType} onChange={(v) => setLinkType(v || "RELATED")} placeholder="Link type" searchPlaceholder="Search link types…" />
            <Combobox options={opts} value={linkTarget} onChange={setLinkTarget} name="targetId" placeholder="Choose a ticket" searchPlaceholder="Search tickets…" />
            <DialogFooter>
              <Button type="submit" disabled={!linkTarget}>Link ticket</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Merge dialog */}
      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Merge ticket</DialogTitle>
            <DialogDescription>
              This ticket will be cancelled and merged into the ticket you choose. You can undo the merge from the merged ticket.
            </DialogDescription>
          </DialogHeader>
          <form action={runMergeTicket} className="grid gap-3">
            <input type="hidden" name="id" value={ticketId} />
            <Combobox options={opts} value={mergeTarget} onChange={setMergeTarget} name="targetId" placeholder="Merge into…" searchPlaceholder="Search tickets…" />
            <DialogFooter>
              <Button type="submit" variant="destructive" disabled={!mergeTarget}>Merge ticket</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
