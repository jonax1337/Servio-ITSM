"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  BookOpen, Eye, EyeOff, ChevronsUp, Flame, Link2, GitMerge, MoreHorizontal, TriangleAlert, UserPlus,
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
import { RaiseProblemDialog } from "@/components/tickets/raise-problem-dialog";
import { useServerMessage, useT } from "@/lib/i18n/client";

type Candidate = { value: string; label: string };

const LINK_TYPES = [
  { value: "RELATED", label: "Related to", tone: "info" },
  { value: "DUPLICATE", label: "Duplicate of", tone: "warning" },
  { value: "BLOCKS", label: "Blocks", tone: "danger" },
  { value: "CAUSED_BY", label: "Caused by", tone: "purple" },
] as const satisfies readonly ComboOption[];

export function TicketActions({
  ticketId, isWatching, isMajorIncident, candidates, watchers = [], people = [], problemDraft = null, canDraftArticle = false,
}: {
  ticketId: number;
  isWatching: boolean;
  isMajorIncident: boolean;
  candidates: Candidate[];
  watchers?: string[];
  people?: Candidate[];
  /** Prefill for "Create problem from this incident"; null when the ticket can't be raised as a problem. */
  problemDraft?: { title: string; description: string } | null;
  /** Resolved or closed tickets can be turned into a knowledge article. */
  canDraftArticle?: boolean;
}) {
  const [problemOpen, setProblemOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [participantOpen, setParticipantOpen] = useState(false);
  const [linkTarget, setLinkTarget] = useState<string>("");
  const [linkType, setLinkType] = useState("RELATED");
  const [mergeTarget, setMergeTarget] = useState<string>("");
  const [participantTarget, setParticipantTarget] = useState<string>("");
  const opts: ComboOption[] = candidates;
  const peopleOpts: ComboOption[] = people;
  const t = useT("tickets");
  const tm = useServerMessage();
  const linkTypeOpts: ComboOption[] = LINK_TYPES.map((o) => ({ ...o, label: t(`linkType.${o.label}`) }));

  /** Typed-result actions surface failures as toasts instead of silently no-oping. */
  async function runToggleWatch(fd: FormData): Promise<void> {
    const res = await toggleWatch(fd);
    if (res && !res.ok) toast.error(res.error ? tm(res.error) : t("actions.watchFailed"));
  }

  async function runEscalateTicket(fd: FormData): Promise<void> {
    const res = await escalateTicket(fd);
    if (res && !res.ok) toast.error(res.error ? tm(res.error) : t("actions.escalateFailed"));
  }

  // A successful merge redirects to the target ticket; only a refusal comes back here.
  async function runMergeTicket(fd: FormData): Promise<void> {
    const res = await mergeTicket(fd);
    if (res && !res.ok) toast.error(res.error ? tm(res.error) : t("actions.mergeFailed"));
  }

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
                {isWatching ? t("actions.watching") : t("actions.watch")}
                {watchers.length > 0 ? <span className="ml-0.5 opacity-70">· {watchers.length}</span> : null}
              </Button>
            </form>
          }
        />
        <TooltipContent>
          {watchers.length > 0 ? (
            <div className="grid gap-0.5">
              <span className="text-xs font-medium">{t("actions.watchingThisTicket")}</span>
              {watchers.slice(0, 8).map((w) => (
                <span key={w} className="text-xs text-muted-foreground">{w}</span>
              ))}
            </div>
          ) : (
            <span className="text-xs">{t("actions.noWatchers")}</span>
          )}
        </TooltipContent>
      </Tooltip>

      {/* Actions menu */}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
          <MoreHorizontal className="size-4" /> {t("actions.menu")}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <form action={runEscalateTicket}>
            <input type="hidden" name="id" value={ticketId} />
            <DropdownMenuItem nativeButton closeOnClick={false} render={<button type="submit" className="w-full" />}>
              <ChevronsUp className="size-4" /> {t("actions.escalate")}
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
              {isMajorIncident ? t("actions.clearMajor") : t("actions.declareMajor")}
            </DropdownMenuItem>
          </form>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setParticipantOpen(true)}>
            <UserPlus className="size-4" /> {t("actions.addParticipantMenu")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setLinkOpen(true)}>
            <Link2 className="size-4" /> {t("actions.linkTicketMenu")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setMergeOpen(true)}>
            <GitMerge className="size-4" /> {t("actions.mergeIntoMenu")}
          </DropdownMenuItem>
          {problemDraft || canDraftArticle ? <DropdownMenuSeparator /> : null}
          {problemDraft ? (
            <DropdownMenuItem onClick={() => setProblemOpen(true)}>
              <TriangleAlert className="size-4" /> {t("actions.createProblemMenu")}
            </DropdownMenuItem>
          ) : null}
          {canDraftArticle ? (
            <DropdownMenuItem render={<Link href={`/knowledge/new?fromTicket=${ticketId}`} />}>
              <BookOpen className="size-4" /> {t("actions.createArticleMenu")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {problemDraft ? (
        <RaiseProblemDialog open={problemOpen} onOpenChange={setProblemOpen} ticketIds={[ticketId]} draft={problemDraft} offerSimilar />
      ) : null}

      {/* Add participant — notify someone without an @mention */}
      <Dialog open={participantOpen} onOpenChange={setParticipantOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("actions.addParticipant")}</DialogTitle>
            <DialogDescription>{t("actions.addParticipantDescription")}</DialogDescription>
          </DialogHeader>
          <form action={async (fd) => { await addParticipant(fd); setParticipantOpen(false); setParticipantTarget(""); }} className="grid gap-3">
            <input type="hidden" name="ticketId" value={ticketId} />
            <Combobox options={peopleOpts} value={participantTarget} onChange={setParticipantTarget} name="userId" placeholder={t("actions.choosePerson")} searchPlaceholder={t("actions.searchPeople")} />
            <Textarea name="note" placeholder={t("actions.participantNote")} className="min-h-16" />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox name="notifyByEmail" /> {t("actions.alsoEmail")}
            </label>
            <DialogFooter>
              <Button type="submit" disabled={!participantTarget}>{t("actions.addParticipant")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Link dialog */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("actions.linkTicket")}</DialogTitle>
            <DialogDescription>{t("actions.linkTicketDescription")}</DialogDescription>
          </DialogHeader>
          <form
            action={async (fd) => {
              const res = await linkTicket(fd);
              if (!res.ok) {
                toast.error(res.error ? tm(res.error) : t("actions.linkFailed"));
                return;
              }
              toast.success(t("actions.ticketLinked"));
              setLinkOpen(false);
              setLinkTarget("");
            }}
            className="grid gap-3"
          >
            <input type="hidden" name="id" value={ticketId} />
            <Combobox name="type" options={linkTypeOpts} value={linkType} onChange={(v) => setLinkType(v || "RELATED")} placeholder={t("actions.linkType")} searchPlaceholder={t("actions.searchLinkTypes")} />
            <Combobox options={opts} value={linkTarget} onChange={setLinkTarget} name="targetId" placeholder={t("actions.chooseTicket")} searchPlaceholder={t("actions.searchTickets")} />
            <DialogFooter>
              <Button type="submit" disabled={!linkTarget}>{t("actions.linkTicket")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Merge dialog */}
      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("actions.mergeTicket")}</DialogTitle>
            <DialogDescription>{t("actions.mergeDescription")}</DialogDescription>
          </DialogHeader>
          <form action={runMergeTicket} className="grid gap-3">
            <input type="hidden" name="id" value={ticketId} />
            <Combobox options={opts} value={mergeTarget} onChange={setMergeTarget} name="targetId" placeholder={t("actions.mergeIntoMenu")} searchPlaceholder={t("actions.searchTickets")} />
            <DialogFooter>
              <Button type="submit" variant="destructive" disabled={!mergeTarget}>{t("actions.mergeTicket")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
