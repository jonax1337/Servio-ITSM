import { Suspense } from "react";
import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { ssoEnabled, ssoProviderName } from "@/auth";
import { Wordmark, BrandName } from "@/components/brand";
import { SableMark } from "@/components/sable-mark";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

// SSO is configured by runtime env (AUTH_OIDC_*). Without this the page is
// prerendered at build time, where those vars are unset, so the published Docker
// image never showed the SSO button (#49).
export const dynamic = "force-dynamic";

const highlights = [
  "Tickets, Problems & Changes — full ITIL flow",
  "CMDB with asset dependency mapping",
  "SSO, self-service portal & a clean REST API",
  "Sable proposes. Your team stays in control.",
];

export default function LoginPage() {
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
              Service,<br /><span className="text-primary">in flow.</span>
            </h1>
            <p className="mt-4 text-muted-foreground">
              Your service desk. A smarter teammate. Bring tickets, knowledge,
              changes and assets together, with Sable working alongside your team.
            </p>
            <ul className="mt-8 grid gap-3">
              {highlights.map((h) => (
                <li key={h} className="flex items-center gap-3 text-sm">
                  <CheckCircle2 className="size-4 shrink-0 text-primary" />
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="grid gap-5">
            <div className="flex items-center gap-3 text-sable"><SableMark className="size-7" /><BrandName brand="sable" className="h-4" /></div>
            <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} Servio · MIT licensed</p>
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
                Welcome back
              </h2>
              <p className="text-sm text-muted-foreground">
                Sign in to your Servio workspace.
              </p>
            </div>
            <Suspense>
              <LoginForm ssoEnabled={ssoEnabled} ssoName={ssoProviderName} />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}
