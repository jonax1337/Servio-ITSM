"use client";

import { useState, useTransition } from "react";
import { ShieldCheck, CheckCircle2, Check, X, Loader2, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  requestApproval, decideEntityApproval, cancelApproval,
} from "@/lib/actions/approvals";
import { UserAvatar } from "@/components/user-avatar";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox, type ComboOption } from "@/components/combobox";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { APPROVAL_META } from "@/lib/constants";
import { requestSelfApprovalError } from "@/lib/approval-rules";
import { LocalTime, timeAgo } from "@/components/local-time";

const initials = (s: string) => s.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

export type EntityApprovalRow = {
  id: string;
  title: string;
  status: string;
  comment: string | null;
  decidedAt: Date | null;
  requestedById: string | null;
  approver: { id: string; name: string | null; email: string };
};

/**
 * Reusable ad-hoc approvals section, mounted on ticket/problem/change/service
 * detail pages. Distinct from the Change CAB and catalog approvals — this is a
 * manual sign-off request against any entity.
 */
export function EntityApprovals({
  entityType,
  entityId,
  entityTitle,
  heading = "Approvals",
  approvals,
  currentUserId,
  isAdmin,
  canManage,
  canRequest,
  agents,
}: {
  entityType: string;
  entityId: string;
  entityTitle: string;
  /** Section heading; pages with a second approval concept (the change CAB) name this one apart. */
  heading?: string;
  approvals: EntityApprovalRow[];
  currentUserId: string;
  isAdmin: boolean;
  canManage: boolean;
  canRequest: boolean;
  agents: { id: string; name: string | null; email: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [approverId, setApproverId] = useState("none");
  const [title, setTitle] = useState("");
  const [pending, start] = useTransition();

  // Can't request from yourself or from someone already on this entity.
  const existing = new Set(approvals.map((a) => a.approver.id));
  const approverOpts: ComboOption[] = agents
    .filter((a) => a.id !== currentUserId && !existing.has(a.id))
    .map((a) => ({ value: a.id, label: a.name ?? a.email, avatar: initials(a.name ?? a.email), hint: a.email }));

  function submitRequest() {
    if (approverId === "none") return;
    const fd = new FormData();
    fd.set("entityType", entityType);
    fd.set("entityId", entityId);
    fd.set("approverId", approverId);
    fd.set("title", title.trim() || entityTitle);
    start(async () => {
      await requestApproval(fd);
      setOpen(false);
      setApproverId("none");
      setTitle("");
      toast.success("Approval requested");
    });
  }

  return (
    <div className="mt-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="size-4 text-muted-foreground" />
          {heading} · {approvals.length}
        </h2>
        {canRequest ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button variant="outline" size="sm" />}>
              <Plus className="size-4" /> Request approval
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Request approval</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="grid gap-1.5">
                  <Label>Approver</Label>
                  <Combobox
                    options={approverOpts}
                    value={approverId}
                    placeholder="Choose an approver…"
                    searchPlaceholder="Search people…"
                    emptyText="No eligible approvers."
                    onChange={setApproverId}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="appr-title">What needs approval?</Label>
                  <Input
                    id="appr-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={entityTitle}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                  Cancel
                </Button>
                <Button type="button" onClick={submitRequest} disabled={pending || approverId === "none"}>
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                  Send request
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>

      {approvals.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-dashed bg-card/50 px-4 py-6 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4" />
          No {heading.toLowerCase()} requested.{canRequest ? " Request a sign-off from a colleague above." : ""}
        </div>
      ) : (
        <div className="grid gap-3">
          {approvals.map((a) => (
            <ApprovalCard
              key={a.id}
              row={a}
              canDecide={a.status === "PENDING" && a.approver.id === currentUserId}
              selfApproval={requestSelfApprovalError(a.requestedById, currentUserId)}
              canCancel={a.status === "PENDING" && (isAdmin || canManage || a.requestedById === currentUserId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ApprovalCard({
  row, canDecide, selfApproval, canCancel,
}: {
  row: EntityApprovalRow;
  canDecide: boolean;
  /** Why the viewer may not decide their own request; shown in place of the controls. */
  selfApproval: string | null;
  canCancel: boolean;
}) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function decide(decision: "APPROVED" | "REJECTED") {
    const fd = new FormData();
    fd.set("approvalId", row.id);
    fd.set("decision", decision);
    if (comment.trim()) fd.set("comment", comment.trim());
    start(async () => {
      const res = await decideEntityApproval(fd);
      if (!res.ok) {
        setError(res.error ?? "The decision could not be recorded.");
        toast.error(res.error ?? "The decision could not be recorded.");
        return;
      }
      setError(null);
      setComment("");
      toast.success(decision === "APPROVED" ? "Approval recorded" : "Rejection recorded");
    });
  }

  function cancel() {
    const fd = new FormData();
    fd.set("approvalId", row.id);
    start(async () => {
      await cancelApproval(fd);
      toast.success("Approval withdrawn");
    });
  }

  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-center gap-3">
        <UserAvatar name={row.approver.name} email={row.approver.email} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{row.approver.name ?? row.approver.email}</div>
          <div className="truncate text-xs text-muted-foreground">
            {row.title ? `${row.title} · ` : ""}
            {row.decidedAt ? <>Decided <LocalTime date={row.decidedAt} render={timeAgo} /></> : "Awaiting decision"}
          </div>
        </div>
        <StatusBadge map={APPROVAL_META} value={row.status} />
        {canCancel ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Withdraw request"
            title="Withdraw request"
            onClick={cancel}
            disabled={pending}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </Button>
        ) : null}
      </div>
      {row.comment ? (
        <p className="mt-2 whitespace-pre-wrap rounded-lg border bg-muted/30 p-2 text-xs text-muted-foreground">
          {row.comment}
        </p>
      ) : null}
      {canDecide && selfApproval ? (
        <p className="mt-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">{selfApproval}</p>
      ) : canDecide ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add a comment (optional)"
            className="h-7 min-w-40 flex-1 text-xs"
          />
          <Button size="sm" variant="outline" disabled={pending} onClick={() => decide("APPROVED")}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            Approve
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => decide("REJECTED")}>
            <X className="size-3.5" /> Reject
          </Button>
          {error ? <p role="alert" className="basis-full text-xs text-destructive">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
