"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, KeyRound, Loader2, PlugZap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { connectClaudeSubscription, testAiConnection } from "@/lib/actions/settings";
import { AI_ASSISTANT_NAME } from "@/lib/constants";
import { useFormatter, useServerMessage, useT } from "@/lib/i18n/client";

/** Works on any machine with Node — no Claude Code install needed. */
const SETUP_COMMANDS = [
  { label: "withNode", command: "npx -y @anthropic-ai/claude-code setup-token" },
  { label: "installed", command: "claude setup-token" },
] as const;

const COPIED_FEEDBACK_MS = 1500;

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const t = useT("settings");
  const copy = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
  };
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/40 py-1.5 pr-1.5 pl-3 font-mono text-xs">
      <span className="min-w-0 flex-1 truncate">{command}</span>
      <Button type="button" variant="ghost" size="icon-sm" onClick={copy} aria-label={t("claude.copyCommand")}>
        {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
      </Button>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[1.5rem_1fr] gap-3">
      <span className="grid size-6 place-items-center rounded-full bg-sable-muted text-xs font-semibold text-sable">
        {n}
      </span>
      <div className="grid min-w-0 gap-2">
        <p className="text-sm font-medium">{title}</p>
        {children}
      </div>
    </li>
  );
}

/**
 * Guided connection of a Claude Pro/Max subscription. Sable runs in an isolated
 * Claude Code instance that can't reuse an interactive login, so it needs a
 * long-lived token. The token is bound to the Claude ACCOUNT, not the machine:
 * the admin can create it on their own computer and paste it here.
 */
export function ClaudeConnectDialog({ connected }: { connected: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [pending, startTransition] = useTransition();
  const t = useT("settings");
  const tm = useServerMessage();
  const f = useFormatter();

  const connect = () =>
    startTransition(async () => {
      const saved = await connectClaudeSubscription(token);
      if (saved?.error) {
        toast.error(tm(saved.error));
        return;
      }
      const check = await testAiConnection();
      if (check.ok) {
        toast.success(
          t("claude.connectedToast", {
            name: AI_ASSISTANT_NAME,
            seconds: f.number(check.latencyMs / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
          }),
        );
        setToken("");
        setOpen(false);
      } else {
        toast.error(t("claude.testFailed", { error: tm(check.error) }));
      }
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant={connected ? "outline" : "default"} size="sm" />}>
        <PlugZap className="size-4" />
        {connected ? t("claude.replaceToken") : t("claude.connect")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-sable" /> {t("claude.title")}
          </DialogTitle>
          <DialogDescription>
            {t("claude.description", { name: AI_ASSISTANT_NAME })}
          </DialogDescription>
        </DialogHeader>

        <ol className="grid gap-5">
          <Step n={1} title={t("claude.step1")}>
            {SETUP_COMMANDS.map((c) => (
              <div key={c.command} className="grid gap-1">
                <span className="text-xs text-muted-foreground">{t(`claude.${c.label}`)}</span>
                <CopyCommand command={c.command} />
              </div>
            ))}
          </Step>
          <Step n={2} title={t("claude.step2")}>
            <p className="text-xs text-muted-foreground">
              {t.rich("claude.step2Hint", { prefix: <code className="font-mono">sk-ant-oat</code> })}
            </p>
          </Step>
          <Step n={3} title={t("claude.step3")}>
            <div className="grid gap-1.5">
              <Label htmlFor="claude-token" className="sr-only">
                {t("claude.tokenLabel")}
              </Label>
              <Input
                id="claude-token"
                type="password"
                autoComplete="off"
                placeholder="sk-ant-oat01-…"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t("claude.storedHint", { name: AI_ASSISTANT_NAME })}
              </p>
            </div>
          </Step>
        </ol>

        <DialogFooter>
          <Button type="button" onClick={connect} disabled={pending || !token.trim()}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
            {t("claude.saveTest")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
