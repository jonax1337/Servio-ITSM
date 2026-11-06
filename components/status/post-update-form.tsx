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

const STATE_OPTIONS = STATUS_INCIDENT_STATES.map((s) => ({
  value: s,
  label: STATUS_INCIDENT_STATE_META[s].label,
  tone: STATUS_INCIDENT_STATE_META[s].tone,
  icon: STATUS_INCIDENT_STATE_META[s].icon,
}));

/** What posting does, given the incident's visibility and the state being posted. */
function audienceNote(isPublic: boolean, currentState: string, nextState: string): string {
  const audience = isPublic
    ? "Posted on the portal status page, visible to everyone."
    : "This incident is a draft, so the update stays internal until a manager publishes it.";
  if (!isPublic) return audience;
  if (nextState === "RESOLVED" && currentState !== "RESOLVED") return `${audience} Resolving moves it to the history and removes the portal banner.`;
  if (isActiveIncidentState(nextState) && currentState === "RESOLVED") return `${audience} Reopening brings the portal banner back.`;
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
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState(currentState);
  const [body, setBody] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await postStatusIncidentUpdate(formData);
      if (!result.ok) {
        toast.error(result.error ?? "Something went wrong.");
        return;
      }
      setBody("");
      toast.success(isPublic ? "Update posted to the portal." : "Update saved to the draft.");
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-3">
      <input type="hidden" name="incidentId" value={incidentId} />
      <div className="grid gap-1.5 sm:max-w-xs">
        <Label>State</Label>
        <Combobox name="state" options={STATE_OPTIONS} value={state} onChange={setState} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="status-update-body">Update</Label>
        <Textarea
          id="status-update-body"
          name="body"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What changed? What should people expect next?"
          required
        />
        <p className="text-xs text-muted-foreground">{audienceNote(isPublic, currentState, state)}</p>
      </div>
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          Post update
        </Button>
      </div>
    </form>
  );
}
