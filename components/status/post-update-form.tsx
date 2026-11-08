"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/combobox";
import { postStatusIncidentUpdate } from "@/lib/actions/status-incidents";
import { isActiveIncidentState } from "@/lib/status-rules";
import { STATUS_INCIDENT_STATES, STATUS_INCIDENT_STATE_META } from "@/lib/constants";
import { useEnumT, useServerMessage, useT } from "@/lib/i18n/client";
import type { Translator } from "@/lib/i18n/translate";

/** What posting does, given the incident's visibility and the state being posted. */
function audienceNote(t: Translator<"status">, isPublic: boolean, currentState: string, nextState: string): string {
  const audience = isPublic ? t("audiencePublic") : t("audienceDraft");
  if (!isPublic) return audience;
  if (nextState === "RESOLVED" && currentState !== "RESOLVED") return `${audience} ${t("audienceResolving")}`;
  if (isActiveIncidentState(nextState) && currentState === "RESOLVED") return `${audience} ${t("audienceReopening")}`;
  return audience;
}

/** Post a timeline update; the chosen state becomes the incident's state. */
export function PostUpdateForm({
  incidentId,
  currentState,
  isPublic,
}: {
  incidentId: string;
  currentState: string;
  isPublic: boolean;
}) {
  const router = useRouter();
  const t = useT("status");
  const tc = useT("common");
  const te = useEnumT();
  const tm = useServerMessage();
  const STATE_OPTIONS = STATUS_INCIDENT_STATES.map((s) => ({
    value: s,
    label: te(STATUS_INCIDENT_STATE_META[s]),
    tone: STATUS_INCIDENT_STATE_META[s].tone,
    icon: STATUS_INCIDENT_STATE_META[s].icon,
  }));
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState(currentState);
  const [body, setBody] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await postStatusIncidentUpdate(formData);
      if (!result.ok) {
        toast.error(result.error ? tm(result.error) : tc("somethingWentWrong"));
        return;
      }
      setBody("");
      toast.success(isPublic ? t("postedToPortal") : t("savedToDraft"));
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-3">
      <input type="hidden" name="incidentId" value={incidentId} />
      <div className="grid gap-1.5 sm:max-w-xs">
        <Label>{t("state")}</Label>
        <Combobox name="state" options={STATE_OPTIONS} value={state} onChange={setState} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="status-update-body">{t("update")}</Label>
        <Textarea
          id="status-update-body"
          name="body"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("updatePlaceholder")}
          required
        />
        <p className="text-xs text-muted-foreground">{audienceNote(t, isPublic, currentState, state)}</p>
      </div>
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          {t("postUpdateButton")}
        </Button>
      </div>
    </form>
  );
}
