"use client";

import { useActionState, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ChevronsUpDown,
  Plug,
  Cloud,
  Cpu,
  Globe,
  GraduationCap,
  HardDrive,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ComboField } from "@/components/combo-field";
import { SableMark } from "@/components/sable-mark";
import { ClaudeConnectDialog } from "@/components/settings/claude-connect-dialog";
import { AiSkillsManager } from "@/components/settings/ai-skills-manager";
import { AiMcpManager, type AiMcpManagerProps } from "@/components/settings/ai-mcp-manager";
import type { SableSkill } from "@/lib/sable-workspace";
import {
  listAiModels,
  saveAiSettings,
  testAiConnection,
  type AiConnectionCheck,
} from "@/lib/actions/settings";
import type { AiModelList } from "@/lib/ai-models";
import { AI_ASSISTANT_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useFormatter, useServerMessage, useT } from "@/lib/i18n/client";
import type { Translator } from "@/lib/i18n/translate";

type Tr = Translator<"settings">;
const providerText = (t: Tr, p: Provider, field: "title" | "description" | "tag", fallback: string) =>
  t.dyn(`aiForm.provider.${p}.${field}`, undefined, fallback);

type Provider = "claude-code" | "anthropic" | "openai" | "ollama";

export type AiSettingsValues = {
  provider: Provider;
  model: string;
  maxTokens: string;
  allowExternal: boolean;
  teaser: boolean;
  ticketTriage: boolean;
  ollamaUrl: string;
  ollamaModel: string;
  webSearchProvider: string;
};

export type AiSecretsSet = {
  anthropic: boolean;
  openai: boolean;
  claudeToken: boolean;
  tavily: boolean;
  brave: boolean;
};

const PROVIDERS: {
  value: Provider;
  title: string;
  description: string;
  tag: string;
  icon: LucideIcon;
}[] = [
  {
    value: "claude-code",
    title: "Claude subscription",
    description: "Your Pro/Max plan via a long-lived token.",
    tag: "Subscription",
    icon: Sparkles,
  },
  {
    value: "anthropic",
    title: "Anthropic API",
    description: "Pay-per-use with an Anthropic API key.",
    tag: "External",
    icon: Cloud,
  },
  {
    value: "openai",
    title: "OpenAI-compatible",
    description: "OpenAI, OpenRouter, Kimi, GLM … via the built-in proxy.",
    tag: "External",
    icon: Globe,
  },
  {
    value: "ollama",
    title: "Ollama",
    description: "A local model. Data never leaves this server.",
    tag: "Local",
    icon: HardDrive,
  },
];

const WEB_SEARCH_OPTIONS = [
  { value: "auto", label: "Auto (use a configured key, else DuckDuckGo)" },
  { value: "tavily", label: "Tavily (API key)" },
  { value: "brave", label: "Brave Search (API key)" },
  { value: "duckduckgo", label: "DuckDuckGo (keyless, best-effort)" },
];

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-4 rounded-xl border bg-card p-5">
      <header className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sable-muted text-sable">
          <Icon className="size-4" />
        </span>
        <div className="grid gap-0.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
      </header>
      {children}
    </section>
  );
}

function ConfiguredBadge({ set }: { set: boolean }) {
  const t = useT("settings");
  return set ? (
    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
      {t("aiForm.configured")}
    </span>
  ) : (
    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {t("aiForm.notSet")}
    </span>
  );
}

function TextField({
  name,
  label,
  defaultValue,
  placeholder,
  hint,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={`ai-${name}`}>{label}</Label>
      <Input id={`ai-${name}`} name={name} defaultValue={defaultValue} placeholder={placeholder} />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** A secret input: never prefilled; blank keeps the stored value. */
function SecretField({ name, label, set, hint }: { name: string; label: string; set: boolean; hint?: string }) {
  const t = useT("settings");
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`ai-${name}`}>{label}</Label>
        <ConfiguredBadge set={set} />
      </div>
      <Input
        id={`ai-${name}`}
        name={name}
        type="password"
        autoComplete="new-password"
        placeholder={set ? t("aiForm.keepPlaceholder") : undefined}
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function SwitchRow({
  name,
  label,
  description,
  defaultChecked,
}: {
  name: string;
  label: string;
  description: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-start justify-between gap-6 rounded-lg px-1 py-1">
      <span className="grid gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
      <Switch name={name} defaultChecked={defaultChecked} className="mt-0.5" />
    </label>
  );
}

/**
 * Free-text model input with the provider's models as suggestions (native
 * datalist: shows id + label, accepts any typed id). The list loads for the
 * selected provider tile with the SAVED credentials; changing the tile or
 * pressing refresh reloads it.
 */
function ModelField({ provider, defaultValue }: { provider: Provider; defaultValue: string }) {
  const [loaded, setLoaded] = useState<{ provider: Provider; nonce: number; list: AiModelList } | null>(null);
  const [nonce, setNonce] = useState(0);
  const [model, setModel] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const t = useT("settings");
  const tm = useServerMessage();
  const loading = loaded?.provider !== provider || loaded.nonce !== nonce;

  useEffect(() => {
    let cancelled = false;
    listAiModels(provider)
      .then((list) => !cancelled && setLoaded({ provider, nonce, list }))
      .catch(() => !cancelled && setLoaded({ provider, nonce, list: { models: [], error: t("aiForm.couldNotLoadModels") } }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on provider/nonce only, not on a locale switch
  }, [provider, nonce]);

  const list = loaded?.provider === provider ? loaded.list : null;
  const models = list?.models ?? [];
  const selected = models.find((m) => m.id === model);
  const custom = search.trim();
  const pick = (id: string) => {
    setModel(id);
    setSearch("");
    setOpen(false);
  };

  return (
    <div className="grid gap-1.5">
      <Label>{t("aiForm.model")}</Label>
      <input type="hidden" name="AI_MODEL" value={model} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              aria-expanded={open}
              className={cn("w-full justify-between gap-2 font-normal", !model && "text-muted-foreground")}
            />
          }
        >
          <span className="truncate">{model ? (selected?.label ?? model) : t("aiForm.providerDefault")}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--anchor-width)] min-w-64 rounded-md p-0">
          <Command>
            <CommandInput placeholder={t("aiForm.searchModel")} value={search} onValueChange={setSearch} />
            <CommandList>
              <CommandEmpty>{loading ? t("aiForm.loadingModels") : t("aiForm.noMatchingModel")}</CommandEmpty>
              {custom && !models.some((m) => m.id === custom) ? (
                <CommandGroup>
                  <CommandItem value={`__custom ${custom}`} onSelect={() => pick(custom)}>
                    {t("aiForm.useCustom", { id: custom })}
                  </CommandItem>
                </CommandGroup>
              ) : null}
              <CommandGroup>
                <CommandItem value="provider default" data-checked={model === ""} onSelect={() => pick("")}>
                  <span className="text-muted-foreground">{t("aiForm.providerDefault")}</span>
                </CommandItem>
                {models.map((m) => (
                  <CommandItem
                    key={m.id}
                    value={`${m.id} ${m.label}`}
                    data-checked={model === m.id}
                    onSelect={() => pick(m.id)}
                  >
                    <span className="truncate">{m.label}</span>
                    {m.label !== m.id ? (
                      <span className="ml-auto truncate text-xs text-muted-foreground">{m.id}</span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup>
                <CommandItem value="__reload model list" disabled={loading} onSelect={() => setNonce((n) => n + 1)}>
                  <RefreshCw className={cn("size-4", loading && "animate-spin")} />
                  {t("aiForm.reloadModels")}
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <p className={cn("text-xs", list?.error ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
        {loading
          ? t("aiForm.loadingModels")
          : list?.error ? tm(list.error) : t("aiForm.modelsAvailable", { count: models.length })}
      </p>
    </div>
  );
}

function StatusCard({
  configured,
  providerTitle,
  model,
  skillCount,
}: {
  configured: boolean;
  providerTitle: string;
  model: string;
  skillCount: number;
}) {
  const [check, setCheck] = useState<AiConnectionCheck | null>(null);
  const [pending, startTransition] = useTransition();
  const runCheck = () => startTransition(async () => setCheck(await testAiConnection()));
  const t = useT("settings");
  const tm = useServerMessage();
  const f = useFormatter();

  return (
    <section className="grid gap-4 rounded-xl border bg-card p-5 sm:grid-cols-[auto_1fr_auto] sm:items-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-sable-muted text-sable">
        <SableMark className="size-7" />
      </span>
      <div className="grid min-w-0 gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-onyx text-xl">{AI_ASSISTANT_NAME}</h2>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
              configured
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
            )}
          >
            <span className={cn("size-1.5 rounded-full", configured ? "bg-emerald-500" : "bg-amber-500")} />
            {configured ? t("aiForm.ready") : t("aiForm.needsSetup")}
          </span>
        </div>
        <p className="truncate text-sm text-muted-foreground">
          {providerTitle} · {model || t("aiForm.providerDefaultLower")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("aiForm.statusLine", { count: skillCount })}
        </p>
        {check ? (
          <p
            className={cn(
              "mt-1 text-xs",
              check.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
            )}
          >
            {check.ok
              ? t("aiForm.connectedIn", {
                  seconds: f.number(check.latencyMs / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                  reply: check.reply,
                })
              : tm(check.error)}
          </p>
        ) : null}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={runCheck} disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Activity className="size-4" />}
        {t("aiForm.testConnection")}
      </Button>
    </section>
  );
}

/**
 * Sable's AI settings: status + live connection check, provider tiles with the
 * matching credentials, model and behaviour, web search, and the agent's
 * skills. Every input keeps its name so `saveAiSettings` is unchanged; inputs of
 * unselected providers stay mounted (only hidden) so their values persist.
 */
export function AiSettingsForm({
  values,
  secrets,
  configured,
  skills,
  mcpServers,
}: {
  values: AiSettingsValues;
  secrets: AiSecretsSet;
  configured: boolean;
  skills: SableSkill[];
  mcpServers: AiMcpManagerProps["servers"];
}) {
  const [provider, setProvider] = useState<Provider>(values.provider);
  const [state, formAction, pending] = useActionState(saveAiSettings, undefined);
  const submit = useFormSubmit(formAction);
  const wasPending = useRef(false);
  const t = useT("settings");
  const tm = useServerMessage();

  useEffect(() => {
    if (wasPending.current && !pending) {
      if (state?.error) toast.error(tm(state.error));
      else if (state?.ok) toast.success(t("aiForm.saved"));
    }
    wasPending.current = pending;
  }, [pending, state, t, tm]);

  const selected = PROVIDERS.find((p) => p.value === provider) ?? PROVIDERS[0];

  return (
    <div className="grid gap-5">
      <StatusCard
        configured={configured}
        providerTitle={(() => {
          const p = PROVIDERS.find((x) => x.value === values.provider);
          return p ? providerText(t, p.value, "title", p.title) : values.provider;
        })()}
        model={values.model}
        skillCount={skills.filter((s) => s.enabled).length}
      />

      <form method="post" onSubmit={submit} className="grid gap-5">
        <Section
          icon={Cpu}
          title={t("aiForm.modelProvider")}
          description={t("aiForm.modelProviderDescription", { name: AI_ASSISTANT_NAME })}
        >
          <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
            {PROVIDERS.map((p) => {
              const active = p.value === provider;
              return (
                <label
                  key={p.value}
                  className={cn(
                    "flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors",
                    active ? "border-sable/50 bg-sable-muted/40 ring-1 ring-sable/30" : "hover:bg-muted/50",
                  )}
                >
                  <input
                    type="radio"
                    name="AI_PROVIDER"
                    value={p.value}
                    checked={active}
                    onChange={() => setProvider(p.value)}
                    className="sr-only"
                  />
                  <p.icon className={cn("mt-0.5 size-4 shrink-0", active ? "text-sable" : "text-muted-foreground")} />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {providerText(t, p.value, "title", p.title)}
                      <span className="rounded-full border px-1.5 py-px text-[10px] font-normal text-muted-foreground">
                        {providerText(t, p.value, "tag", p.tag)}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">{providerText(t, p.value, "description", p.description)}</span>
                  </span>
                </label>
              );
            })}
          </div>

          <div className="grid gap-4 rounded-lg border border-dashed p-4">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{providerText(t, selected.value, "title", selected.title)}</p>

            <div hidden={provider !== "claude-code"} className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm">
                  {t("aiForm.subscriptionToken")} <ConfiguredBadge set={secrets.claudeToken} />
                </div>
                <ClaudeConnectDialog connected={secrets.claudeToken} />
              </div>
              <p className="text-xs text-muted-foreground">
                {t("aiForm.subscriptionHint")}
              </p>
            </div>

            <div hidden={provider !== "anthropic"}>
              <SecretField name="ANTHROPIC_API_KEY" label={t("aiForm.anthropicKey")} set={secrets.anthropic} />
            </div>

            <div hidden={provider !== "openai"}>
              <SecretField
                name="OPENAI_API_KEY"
                label={t("aiForm.apiKey")}
                set={secrets.openai}
                hint={t("aiForm.openaiHint")}
              />
            </div>

            <div hidden={provider !== "ollama"} className="grid gap-4 sm:grid-cols-2">
              <TextField
                name="OLLAMA_BASE_URL"
                label={t("aiForm.ollamaUrl")}
                defaultValue={values.ollamaUrl}
                placeholder="http://localhost:11434/v1"
              />
              <TextField
                name="OLLAMA_MODEL"
                label={t("aiForm.ollamaModel")}
                defaultValue={values.ollamaModel}
                placeholder="llama3.1"
              />
            </div>
          </div>
        </Section>

        <Section icon={SlidersHorizontal} title={t("aiForm.modelLimits")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <ModelField provider={provider} defaultValue={values.model} />
            <TextField
              name="AI_MAX_OUTPUT_TOKENS"
              label={t("aiForm.maxTokens")}
              defaultValue={values.maxTokens}
              placeholder={t("aiForm.maxTokensPlaceholder")}
              hint={t("aiForm.maxTokensHint")}
            />
          </div>
        </Section>

        <Section icon={ShieldCheck} title={t("aiForm.privacy")}>
          <div className="grid gap-2">
            <SwitchRow
              name="AI_ALLOW_EXTERNAL"
              label={t("aiForm.allowExternal")}
              description={t("aiForm.allowExternalHint")}
              defaultChecked={values.allowExternal}
            />
            <SwitchRow
              name="AI_TICKET_TRIAGE"
              label={t("aiForm.triage")}
              description={t("aiForm.triageHint", { name: AI_ASSISTANT_NAME })}
              defaultChecked={values.ticketTriage}
            />
            <SwitchRow
              name="AI_TEASER"
              label={t("aiForm.teaser")}
              description={t("aiForm.teaserHint")}
              defaultChecked={values.teaser}
            />
          </div>
        </Section>

        <Section
          icon={Globe}
          title={t("aiForm.webSearch")}
          description={t("aiForm.webSearchDescription")}
        >
          <div className="grid gap-1.5">
            <Label>{t("aiForm.searchProvider")}</Label>
            <ComboField
              name="WEB_SEARCH_PROVIDER"
              options={WEB_SEARCH_OPTIONS.map((o) => ({ value: o.value, label: t.dyn(`aiForm.search.${o.value}`, undefined, o.label) }))} defaultValue={values.webSearchProvider} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SecretField name="TAVILY_API_KEY" label={t("aiForm.tavilyKey")} set={secrets.tavily} />
            <SecretField name="BRAVE_API_KEY" label={t("aiForm.braveKey")} set={secrets.brave} />
          </div>
        </Section>

        <div className="sticky bottom-4 flex justify-end">
          <Button type="submit" disabled={pending} className="shadow-lg">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {t("aiForm.saveChanges")}
          </Button>
        </div>
      </form>

      {/* Outside the form: skill changes save on their own, not with "Save changes". */}
      <Section
        icon={GraduationCap}
        title={t("aiForm.skills")}
        description={t("aiForm.skillsDescription", { name: AI_ASSISTANT_NAME })}
      >
        <AiSkillsManager skills={skills} />
      </Section>

      <Section
        icon={Plug}
        title={t("aiForm.mcp")}
        description={t("aiForm.mcpDescription", { name: AI_ASSISTANT_NAME })}
      >
        <AiMcpManager servers={mcpServers} allowExternal={values.allowExternal} />
      </Section>
    </div>
  );
}
