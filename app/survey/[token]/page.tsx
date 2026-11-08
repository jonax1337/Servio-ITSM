import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { ticketRef } from "@/lib/constants";
import { getSurveyByToken } from "@/lib/csat-survey";
import { SurveyForm } from "./survey-form";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("survey");
  return { title: t("pageTitle") };
}

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
  const t = await getT("survey");

  const ref = survey?.ticket
    ? ticketRef(survey.ticket.id, survey.ticket.prefix)
    : null;

  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden bg-sidebar p-6">
      <div className="absolute inset-0 bg-grid opacity-60" />
      <div className="absolute -left-24 top-1/3 size-[36rem] rounded-full bg-primary/20 blur-3xl" />

      <div className="relative w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Wordmark />
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
          {!survey ? (
            <ClosedState
              title={t("unavailableTitle")}
              body={t("unavailableText")}
            />
          ) : survey.respondedAt ? (
            <ClosedState
              title={t("thanksTitle")}
              body={t("thanksText")}
            />
          ) : (
            <>
              <div className="mb-6 grid gap-1.5">
                <h1 className="font-display text-2xl font-semibold tracking-tight">
                  {t("howDidWeDo")}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {ref
                    ? t.rich("requestResolved", {
                        ref,
                        title: survey.ticket?.title ? t("requestTitle", { title: survey.ticket.title }) : "",
                        mono: (chunks) => <span className="font-mono">{chunks}</span>,
                      })
                    : t("pleaseRate")}
                </p>
              </div>
              <SurveyForm token={survey.token} />
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          {t("copyright", { year: String(new Date().getFullYear()) })}
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
