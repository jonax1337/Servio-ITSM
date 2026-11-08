"use client";

import { useState, useTransition } from "react";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { addChangeApprover } from "@/lib/actions/changes";
import { Combobox, type ComboOption } from "@/components/combobox";
import { Button } from "@/components/ui/button";
import { useServerMessage, useT } from "@/lib/i18n/client";

export function AddApprover({ changeId, agentOptions }: { changeId: number; agentOptions: ComboOption[] }) {
  const [value, setValue] = useState("none");
  const [pending, start] = useTransition();
  const t = useT("changes");
  const tc = useT("common");
  const tm = useServerMessage();
  const opts: ComboOption[] = [{ value: "none", label: t("approvers.select") }, ...agentOptions];

  const submit = () => {
    if (value === "none") return;
    const fd = new FormData();
    fd.set("changeId", String(changeId));
    fd.set("approverId", value);
    start(async () => {
      const res = await addChangeApprover(fd);
      if (!res.ok) {
        toast.error(res.error ? tm(res.error) : t("approvers.addFailed"));
        return;
      }
      setValue("none");
      toast.success(t("approvers.added"));
    });
  };

  return (
    <div className="flex items-center gap-2">
      <Combobox options={opts} value={value} onChange={setValue} className="w-52" size="sm" searchPlaceholder={t("approvers.searchPeople")} />
      <Button size="sm" variant="outline" disabled={pending || value === "none"} onClick={submit}>
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} {tc("add")}
      </Button>
    </div>
  );
}
