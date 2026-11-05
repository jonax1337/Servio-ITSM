"use client";

import { useTransition } from "react";
import { Loader2, ArrowUpDown, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  addGroupMember, removeGroupMember, setGroupMemberRole,
} from "@/lib/actions/groups";
import { Combobox, type ComboOption } from "@/components/combobox";
import { UserAvatar } from "@/components/user-avatar";
import { ConfirmButton } from "@/components/confirm-dialog";

const initials = (s: string) => s.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

type Member = {
  id: string;
  role: string;
  user: { id: string; name: string | null; email: string };
};

/** Manage a group's membership: add from the agent pool, flip lead/member, remove.
 *  Server actions are manager+ gated; this component is only rendered for managers. */
export function GroupMembers({
  groupId,
  members,
  candidates,
}: {
  groupId: string;
  members: Member[];
  candidates: { id: string; name: string | null; email: string }[];
}) {
  const [pending, start] = useTransition();

  const candidateOpts: ComboOption[] = candidates.map((c) => ({
    value: c.id,
    label: c.name ?? c.email,
    avatar: initials(c.name ?? c.email),
    hint: c.email,
  }));

  function add(userId: string) {
    if (userId === "none") return;
    const fd = new FormData();
    fd.set("groupId", groupId);
    fd.set("userId", userId);
    fd.set("role", "MEMBER");
    start(async () => {
      await addGroupMember(fd);
      toast.success("Member added");
    });
  }

  function toggleRole(memberId: string, current: string) {
    const next = current === "LEAD" ? "MEMBER" : "LEAD";
    const fd = new FormData();
    fd.set("memberId", memberId);
    fd.set("role", next);
    start(async () => {
      await setGroupMemberRole(fd);
      toast.success(next === "LEAD" ? "Promoted to lead" : "Set as member");
    });
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Combobox
            options={candidateOpts}
            value="none"
            pending={pending}
            placeholder="Add a member…"
            searchPlaceholder="Search agents…"
            emptyText={candidateOpts.length === 0 ? "Everyone's already a member." : "No matches."}
            onChange={add}
          />
        </div>
      </div>

      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">No members yet — add one above.</p>
      ) : (
        <div className="grid gap-1">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-accent/50">
              <UserAvatar name={m.user.name} email={m.user.email} className="shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="line-clamp-1 text-sm font-medium">{m.user.name ?? m.user.email}</div>
                <div className="line-clamp-1 text-xs text-muted-foreground">{m.user.email}</div>
              </div>
              <button
                type="button"
                onClick={() => toggleRole(m.id, m.role)}
                disabled={pending}
                title={m.role === "LEAD" ? "Demote to member" : "Promote to lead"}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors disabled:opacity-50 ${
                  m.role === "LEAD"
                    ? "border-primary/20 bg-primary/10 text-primary hover:bg-primary/20"
                    : "border-border bg-muted text-muted-foreground hover:bg-accent"
                }`}
              >
                {pending ? <Loader2 className="size-3 animate-spin" /> : <ArrowUpDown className="size-3" />}
                {m.role === "LEAD" ? "Lead" : "Member"}
              </button>
              <ConfirmButton
                action={removeGroupMember}
                fields={{ memberId: m.id }}
                title="Remove member"
                description={`Remove ${m.user.name ?? m.user.email} from this group?`}
                confirmLabel="Remove"
                triggerVariant="outline"
                triggerSize="icon-sm"
                triggerLabel="Remove member"
                triggerClassName="text-muted-foreground hover:border-destructive/40 hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </ConfirmButton>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
