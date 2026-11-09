import { Suspense } from "react";
import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { ssoEnabled, ssoProviderName } from "@/auth";
import { Wordmark, BrandName } from "@/components/brand";
import { SableMark } from "@/components/sable-mark";
import { LoginForm } from "./login-form";
import { getLocale, getT } from "@/lib/i18n/server";
import { LOCALES, LOCALE_NAMES } from "@/lib/i18n/config";
import { setSignedOutLocale } from "@/lib/actions/locale";
import { cn } from "@/lib/utils";
import { db } from "@/lib/db";
import { passwordLoginMode, showPasswordForm } from "@/lib/login-methods";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("auth");
  return { title: t("pageTitle") };
}

// SSO is configured by runtime env (AUTH_OIDC_*). Without this the page is
// prerendered at build time, where those vars are unset, so the published Docker
// image never showed the SSO button (#49).
export const dynamic = "force-dynamic";

const HIGHLIGHTS = ["highlightItil", "highlightCmdb", "highlightSso", "highlightSable"] as const;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ local?: string | string[] }>;
}) {
  const [t, locale, sp] = await Promise.all([getT("auth"), getLocale(), searchParams]);
  const mode = passwordLoginMode(process.env.AUTH_PASSWORD_LOGIN);
  // Only look at the accounts when the answer can change the outcome.
  const needsAccountCheck = ssoEnabled && mode === "auto";
  const hasPasswordAccounts = needsAccountCheck
    ? (await db.user.count({ where: { isActive: true, passwordHash: { not: null } } })) > 0
    : true;
  const passwordForm = showPasswordForm({
    mode,
    ssoEnabled,
    hasPasswordAccounts,
    breakGlass: sp.local === "1",
  });
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      {/* Left: brand / marketing panel */}
      <div className="relative hidden overflow-hidden border-r bg-sidebar lg:block">
        <div className="absolute inset-0 bg-grid opacity-60" />
        <SableMark className="pointer-events-none absolute -bottom-12 -right-12 size-96 text-brand-cobalt/10 dark:text-brand-ice/10" />
        <div className="absolute -left-24 top-1/3 size-[36rem] rounded-full bg-primary/20 blur-3xl" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <Wordmark />
          <div className="max-w-md">
            <h1 className="font-display text-4xl font-semibold leading-tight tracking-tight">
              {t("heroLine1")}<br /><span className="text-primary">{t("heroLine2")}</span>
            </h1>
            <p className="mt-4 text-muted-foreground">
              {t("heroText")}
            </p>
            <ul className="mt-8 grid gap-3">
              {HIGHLIGHTS.map((h) => (
                <li key={h} className="flex items-center gap-3 text-sm">
                  <CheckCircle2 className="size-4 shrink-0 text-primary" />
                  <span>{t(h)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="grid gap-5">
            <div className="flex items-center gap-3 text-sable"><SableMark className="size-7" /><BrandName brand="sable" className="h-4" /></div>
            <p className="text-xs text-muted-foreground">{t("copyright", { year: String(new Date().getFullYear()) })}</p>
          </div>
        </div>
      </div>

      {/* Right: sign-in */}
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Wordmark />
          </div>
          <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
            <div className="mb-6 grid gap-1.5">
              <h2 className="font-display text-2xl font-semibold tracking-tight">
                {t("welcomeBack")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t("signInSubtitle")}
              </p>
            </div>
            <Suspense>
              <LoginForm ssoEnabled={ssoEnabled} ssoName={ssoProviderName} passwordForm={passwordForm} />
            </Suspense>
          </div>
          {/* Language for signed-out visitors (cookie); signed-in users pick it in Account settings. */}
          <form action={setSignedOutLocale} className="mt-4 flex items-center justify-center gap-1 text-xs text-muted-foreground">
            <span className="sr-only">{t("language")}</span>
            {LOCALES.map((l, i) => (
              <span key={l} className="flex items-center gap-1">
                {i > 0 ? <span aria-hidden>·</span> : null}
                <button
                  type="submit"
                  name="locale"
                  value={l}
                  lang={l}
                  aria-pressed={l === locale}
                  className={cn(
                    "rounded px-1.5 py-0.5 transition-colors hover:text-foreground",
                    l === locale && "font-medium text-foreground",
                  )}
                >
                  {LOCALE_NAMES[l]}
                </button>
              </span>
            ))}
          </form>
        </div>
      </div>
    </div>
  );
}
