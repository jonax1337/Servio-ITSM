"use client";

import { useActionState, useState } from "react";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { CheckCircle2, Loader2, Star } from "lucide-react";
import { submitSurvey, type SurveyState } from "@/lib/actions/survey";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { SURVEY_RATING_MAX, SURVEY_RATING_MIN } from "@/lib/constants";

const RATINGS = Array.from(
  { length: SURVEY_RATING_MAX - SURVEY_RATING_MIN + 1 },
  (_, i) => SURVEY_RATING_MIN + i,
);

const RATING_LABELS: Record<number, string> = {
  1: "Very dissatisfied",
  2: "Dissatisfied",
  3: "Neutral",
  4: "Satisfied",
  5: "Very satisfied",
};

/** Client-side rating widget + comment, posting to the public submitSurvey action. */
export function SurveyForm({ token }: { token: string }) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [state, action, pending] = useActionState<SurveyState, FormData>(
    submitSurvey,
    undefined,
  );
  const submit = useFormSubmit(action);

  if (state && "ok" in state) {
    return (
      <div className="grid place-items-center gap-3 py-4 text-center">
        <CheckCircle2 className="size-10 text-primary" />
        <h2 className="font-display text-xl font-semibold tracking-tight">Thank you!</h2>
        <p className="text-sm text-muted-foreground">
          Your feedback has been recorded — it helps us improve.
        </p>
      </div>
    );
  }

  const alreadyDone = state && "error" in state && state.error === "already-submitted";
  if (alreadyDone) {
    return (
      <div className="grid place-items-center gap-3 py-4 text-center">
        <CheckCircle2 className="size-10 text-primary" />
        <h2 className="font-display text-xl font-semibold tracking-tight">
          Already submitted
        </h2>
        <p className="text-sm text-muted-foreground">
          This survey has already been answered. Thank you!
        </p>
      </div>
    );
  }

  const active = hover || rating;

  return (
    <form onSubmit={submit} className="grid gap-5">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="rating" value={rating || ""} />

      <div className="grid gap-2">
        <div className="flex items-center justify-center gap-1.5">
          {RATINGS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              aria-label={`${n} — ${RATING_LABELS[n]}`}
              className="rounded-md p-1 outline-none transition-transform hover:scale-110 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Star
                className={cn(
                  "size-8 transition-colors",
                  n <= active
                    ? "fill-amber-400 text-amber-400"
                    : "text-muted-foreground/40",
                )}
              />
            </button>
          ))}
        </div>
        <p className="h-5 text-center text-sm text-muted-foreground">
          {active ? RATING_LABELS[active] : "Tap a star to rate"}
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="comment">Anything else? (optional)</Label>
        <Textarea
          id="comment"
          name="comment"
          rows={4}
          maxLength={2000}
          placeholder="Tell us what went well or what we could do better…"
        />
      </div>

      {state && "error" in state && !alreadyDone ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={pending || rating === 0}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        Submit feedback
      </Button>
    </form>
  );
}
