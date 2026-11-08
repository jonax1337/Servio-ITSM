"use client";

import { useActionState } from "react";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { useSearchParams } from "next/navigation";
import { Loader2, LogIn, ShieldCheck } from "lucide-react";
import { authenticate, ssoSignIn, type LoginState } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useServerMessage, useT } from "@/lib/i18n/client";

// Demo credentials are a dev/demo convenience only: shown outside production
// builds, or in production when NEXT_PUBLIC_DEMO_MODE="true" is set explicitly
// (e.g. the public demo instance). Never rendered for real production users.
const SHOW_DEMO_CREDENTIALS =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_DEMO_MODE === "true";

export function LoginForm({
  ssoEnabled,
  ssoName,
}: {
  ssoEnabled: boolean;
  ssoName: string;
}) {
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") ?? "/";
  const [state, action, pending] = useActionState<LoginState, FormData>(
    authenticate,
    undefined,
  );
  const submit = useFormSubmit(action);
  const t = useT("auth");
  const tm = useServerMessage();

  return (
    <div className="grid gap-5">
      {ssoEnabled ? (
        <>
          <form action={() => ssoSignIn(callbackUrl)}>
            <Button type="submit" variant="outline" className="w-full" size="lg">
              <ShieldCheck className="size-4" />
              {t("continueWith", { provider: ssoName })}
            </Button>
          </form>
          <div className="relative">
            <Separator />
            <span className="absolute inset-0 -top-2.5 mx-auto w-fit bg-card px-2 text-xs text-muted-foreground">
              {t("orEmail")}
            </span>
          </div>
        </>
      ) : null}

      <form method="post" onSubmit={submit} className="grid gap-4">
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <div className="grid gap-2">
          <Label htmlFor="email">{t("email")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder={t("emailPlaceholder")}
            autoComplete="email"
            defaultValue={SHOW_DEMO_CREDENTIALS ? "admin@servio.dev" : undefined}
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password">{t("password")}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="••••••••"
            autoComplete="current-password"
            defaultValue={SHOW_DEMO_CREDENTIALS ? "servio123" : undefined}
            required
          />
        </div>

        {state?.error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {tm(state.error)}
          </p>
        ) : null}

        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <LogIn className="size-4" />
          )}
          {t("signIn")}
        </Button>
      </form>

      {SHOW_DEMO_CREDENTIALS ? (
        <p className="text-center text-xs text-muted-foreground">
          {t("demoPrefilled")}{" "}
          <span className="font-mono">admin@servio.dev</span> /{" "}
          <span className="font-mono">servio123</span>
        </p>
      ) : null}
    </div>
  );
}
