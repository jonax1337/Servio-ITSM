"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { useRouter } from "next/navigation";
import { User, SlidersHorizontal, PenLine, Loader2, Save, Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { updateMySettings, getMyAccount, type ActionState } from "@/lib/actions/account";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  ProfileFields,
  PreferencesFields,
  SignatureFields,
  type AccountUser,
} from "@/components/account/account-fields";
import { useServerMessage, useT } from "@/lib/i18n/client";

type SectionId = "profile" | "preferences" | "signature";

const SECTIONS: { id: SectionId; label: "profile" | "preferences" | "signature"; icon: LucideIcon }[] = [
  { id: "profile", label: "profile", icon: User },
  { id: "preferences", label: "preferences", icon: SlidersHorizontal },
  { id: "signature", label: "signature", icon: PenLine },
];

export function AccountSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const t = useT("account");
  const tm = useServerMessage();
  const [user, setUser] = useState<AccountUser | null>(null);
  const [section, setSection] = useState<SectionId>("profile");
  const [state, action, pending] = useActionState<ActionState, FormData>(
    updateMySettings,
    undefined,
  );
  const submit = useFormSubmit(action);

  // Load (fresh) account data whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    let active = true;
    // intentional: reset to a clean loading state before fetching fresh account data on open.
    /* eslint-disable react-hooks/set-state-in-effect */
    setUser(null);
    setSection("profile");
    /* eslint-enable react-hooks/set-state-in-effect */
    getMyAccount().then((data) => {
      if (active) setUser(data);
    });
    return () => {
      active = false;
    };
  }, [open]);

  // Remount the form with the freshly saved values so every section shows what is stored.
  const [formKey, setFormKey] = useState(0);
  useEffect(() => {
    if (!state?.ok) return;
    router.refresh(); // reflect a saved name/avatar change in the surrounding server UI
    let active = true;
    getMyAccount().then((data) => {
      if (!active) return;
      setUser(data);
      setFormKey((k) => k + 1);
    });
    return () => {
      active = false;
    };
  }, [state, router]);

  const fe = tm.fields(state?.fieldErrors) ?? {};

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="h-[36rem] max-h-[calc(100dvh-2rem)] gap-0 overflow-hidden p-0 sm:max-w-3xl"
      >
        <DialogTitle className="sr-only">{t("dialogTitle")}</DialogTitle>

        {user === null ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <form
            key={formKey}
            method="post"
            onSubmit={submit}
            className="grid h-full min-h-0 sm:grid-cols-[190px_1fr]"
          >
            {/* Sidebar */}
            <aside className="flex flex-row gap-1 border-b bg-muted/30 p-3 sm:flex-col sm:border-b-0 sm:border-r">
              <div className="hidden px-2 pb-1 pt-1 text-xs font-semibold text-muted-foreground sm:block">
                {t("dialogTitle")}
              </div>
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSection(s.id)}
                  className={cn(
                    "flex flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors sm:flex-none",
                    section === s.id
                      ? "bg-card font-medium text-foreground shadow-sm ring-1 ring-foreground/10"
                      : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
                  )}
                >
                  <s.icon className="size-4 shrink-0" />
                  {t(s.label)}
                </button>
              ))}
            </aside>

            {/* Content */}
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex-1 min-h-0 overflow-y-auto p-5">
                {state?.error ? (
                  <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {tm(state.error)}
                  </p>
                ) : null}

                <div className={cn(section !== "profile" && "hidden")}>
                  <SectionHeader
                    title={t("profile")}
                    description={t("profileDescription")}
                  />
                  <ProfileFields user={user} fe={fe} />
                </div>

                <div className={cn(section !== "preferences" && "hidden")}>
                  <SectionHeader
                    title={t("preferences")}
                    description={t("preferencesDescription")}
                  />
                  <PreferencesFields user={user} />
                </div>

                <div className={cn(section !== "signature" && "hidden")}>
                  <SectionHeader
                    title={t("signatureTitle")}
                    description={t("signatureDescription")}
                  />
                  <SignatureFields user={user} />
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-3 border-t bg-muted/50 px-4 py-3">
                {state?.ok ? (
                  <span className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                    <Check className="size-4" /> {t("saved")}
                  </span>
                ) : null}
                <Button type="submit" disabled={pending}>
                  {pending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  {t("saveChanges")}
                </Button>
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SectionHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mb-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
