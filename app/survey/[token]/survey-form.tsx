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
import { useServerMessage, useT } from "@/lib/i18n/client";

const RATINGS = Array.from(
  { length: SURVEY_RATING_MAX - SURVEY_RATING_MIN + 1 },
  (_, i) => SURVEY_RATING_MIN + i,
);


/** Client-side rating widget + comment, posting to the public submitSurvey action. */
export function SurveyForm({ token }: { token: string }) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [state, action, pending] = useActionState<SurveyState, FormData>(
    submitSurvey,
    undefined,
  );
  const submit = useFormSubmit(action);
  const t = useT("survey");
  const tm = useServerMessage();
  const ratingLabel = (n: number) => t.dyn(`rating.${n}`, undefined, String(n));

  if (state && "ok" in state) {
    return (
      <div className="grid place-items-center gap-3 py-4 text-center">
        <CheckCircle2 className="size-10 text-primary" />
        <h2 className="font-display text-xl font-semibold tracking-tight">{t("thankYou")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("recorded")}
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
          {t("alreadySubmitted")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("alreadyAnswered")}
        </p>
      </div>
    );
  }

  const active = hover || rating;

  return (
    <form method="post" onSubmit={submit} className="grid gap-5">
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
              aria-label={t("ratingAria", { n: String(n), label: ratingLabel(n) })}
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
          {active ? ratingLabel(active) : t("tapToRate")}
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="comment">{t("anythingElse")}</Label>
        <Textarea
          id="comment"
          name="comment"
          rows={4}
          maxLength={2000}
          placeholder={t("commentPlaceholder")}
        />
      </div>

      {state && "error" in state && !alreadyDone ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {tm(state.error)}
        </p>
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={pending || rating === 0}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {t("submitFeedback")}
      </Button>
    </form>
  );
}
