import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { ticketRef } from "@/lib/constants";
import { getSurveyByToken } from "@/lib/csat-survey";
import { SurveyForm } from "./survey-form";

export const metadata: Metadata = { title: "Rate our support" };

/**
 * PUBLIC customer-satisfaction (CSAT) rating page. Reachable without login —
 * proxy.ts whitelists /survey. The token in the URL is the sole credential;
 * unknown/used tokens render a friendly closed state instead of the form.
 */
export default async function SurveyPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const survey = await getSurveyByToken(token);

  const ref = survey?.ticket
    ? ticketRef(survey.ticket.id, survey.ticket.prefix)
    : null;

  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden bg-sidebar p-6">
      <div className="absolute inset-0 bg-grid opacity-60" />
      <div className="absolute -left-24 top-1/3 size-[36rem] rounded-full bg-primary/20 blur-3xl" />

      <div className="relative w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Wordmark subtitle="Open-Source ITSM" />
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
          {!survey ? (
            <ClosedState
              title="Survey unavailable"
              body="This survey link is not valid or has expired."
            />
          ) : survey.respondedAt ? (
            <ClosedState
              title="Thanks for your feedback!"
              body="You've already rated this request. We appreciate you taking the time."
            />
          ) : (
            <>
              <div className="mb-6 grid gap-1.5">
                <h1 className="font-display text-2xl font-semibold tracking-tight">
                  How did we do?
                </h1>
                <p className="text-sm text-muted-foreground">
                  {ref ? (
                    <>
                      Your request{" "}
                      <span className="font-mono">{ref}</span>
                      {survey.ticket?.title ? ` — “${survey.ticket.title}”` : ""} was
                      resolved. Please rate the support you received.
                    </>
                  ) : (
                    "Please rate the support you received."
                  )}
                </p>
              </div>
              <SurveyForm token={survey.token} />
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Servio · MIT licensed
        </p>
      </div>
    </div>
  );
}

function ClosedState({ title, body }: { title: string; body: string }) {
  return (
    <div className="grid place-items-center gap-3 py-4 text-center">
      <CheckCircle2 className="size-10 text-primary" />
      <h1 className="font-display text-xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
