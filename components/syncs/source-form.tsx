"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { useFormStatus } from "react-dom";
import { Loader2, Save, Trash2, Plug } from "lucide-react";
import { toast } from "sonner";
import {
  createSyncSource,
  updateSyncSource,
  deleteSyncSource,
  testSyncConnection,
  type ActionState,
} from "@/lib/actions/syncs";
import {
  CONNECTOR_SPECS,
  CONFIGURABLE_TYPES,
  SCOPE_LABELS,
  getSpec,
  fieldsFor,
  sectionsOf,
  type ConnectorSpec,
  type FieldSpec,
} from "@/lib/connectors/spec";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/combobox";
import { LinkButton } from "@/components/link-button";
import { ConfirmButton } from "@/components/confirm-dialog";

type FieldValue = string | number | boolean;

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      {label}
    </Button>
  );
}

/** Renders the fields for one connector type + scope, grouped by section. */
function ConnectorFields({
  spec,
  scope,
  values,
  passwordSet,
}: {
  spec: ConnectorSpec;
  scope: string;
  values?: Record<string, FieldValue>;
  passwordSet: boolean;
}) {
  const fields = fieldsFor(spec, scope);
  const val = (name: string): FieldValue => values?.[name] ?? spec.defaults[name] ?? "";

  // Only select fields need to be controlled (to drive showWhen).
  const [watch, setWatch] = useState<Record<string, string>>(() => {
    const w: Record<string, string> = {};
    for (const f of fields) if (f.type === "select") w[f.name] = String(val(f.name));
    return w;
  });

  const visible = (f: FieldSpec) =>
    !f.showWhen || String(watch[f.showWhen.field]) === String(f.showWhen.equals);

  return (
    <div className="grid gap-6">
      {sectionsOf(fields).map((section) => {
        const inSection = fields.filter((f) => f.section === section && visible(f));
        if (inSection.length === 0) return null;
        return (
          <section key={section} className="grid gap-4">
            <h3 className="text-sm font-semibold">{section}</h3>
            {inSection.map((f) => (
              <Fieldset key={f.name} field={f} value={val(f.name)} watch={watch} setWatch={setWatch} passwordSet={passwordSet} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function Fieldset({
  field: f,
  value,
  watch,
  setWatch,
  passwordSet,
}: {
  field: FieldSpec;
  value: FieldValue;
  watch: Record<string, string>;
  setWatch: Dispatch<SetStateAction<Record<string, string>>>;
  passwordSet: boolean;
}) {
  if (f.type === "switch") {
    return (
      <label className="flex items-center justify-between gap-4">
        <span className="grid gap-0.5">
          <span className="text-sm font-medium">{f.label}</span>
          {f.hint ? <span className="text-xs text-muted-foreground">{f.hint}</span> : null}
        </span>
        <Switch name={f.name} defaultChecked={Boolean(value)} />
      </label>
    );
  }

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`f-${f.name}`}>{f.label}</Label>
        {f.type === "password" && passwordSet ? (
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            Configured
          </span>
        ) : null}
      </div>

      {f.type === "select" ? (
        <Combobox
          name={f.name}
          options={f.options ?? []}
          value={watch[f.name]}
          onChange={(v) => setWatch((w) => ({ ...w, [f.name]: v }))}
          searchPlaceholder="Search…"
        />
      ) : f.type === "textarea" ? (
        <Textarea
          id={`f-${f.name}`}
          name={f.name}
          defaultValue={String(value)}
          placeholder={f.placeholder}
          rows={6}
          className={f.mono ? "font-mono text-xs" : undefined}
        />
      ) : (
        <Input
          id={`f-${f.name}`}
          name={f.name}
          type={f.type === "number" ? "number" : f.type === "password" ? "password" : "text"}
          defaultValue={f.type === "password" ? "" : String(value)}
          placeholder={
            f.type === "password" && passwordSet ? "•••••••• (leave blank to keep)" : f.placeholder
          }
          autoComplete={f.type === "password" ? "new-password" : undefined}
          className={f.mono ? "font-mono text-xs" : undefined}
        />
      )}
      {f.type !== "password" && f.hint ? (
        <p className="text-xs text-muted-foreground">{f.hint}</p>
      ) : null}
    </div>
  );
}

export function SyncSourceForm({
  mode,
  source,
  values,
  passwordSet = false,
}: {
  mode: "create" | "edit";
  source?: { id: string; name: string; type: string; schedule: string | null; scope: string };
  values?: Record<string, FieldValue>;
  passwordSet?: boolean;
}) {
  const initialType = source?.type ?? CONFIGURABLE_TYPES[0].type;
  const [type, setType] = useState(initialType);
  const [scope, setScope] = useState(
    source?.scope ?? getSpec(initialType)?.scopes[0] ?? "USERS",
  );
  const action = mode === "create" ? createSyncSource : updateSyncSource;
  const [state, formAction] = useActionState<ActionState, FormData>(action, undefined);
  const submit = useFormSubmit(formAction);
  const wasErr = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (state?.error && state.error !== wasErr.current) toast.error(state.error);
    wasErr.current = state?.error;
  }, [state]);

  const spec = getSpec(type) ?? CONNECTOR_SPECS[CONFIGURABLE_TYPES[0].type];

  // Switching type resets the scope to that type's first supported scope.
  function changeType(t: string) {
    setType(t);
    setScope(getSpec(t)?.scopes[0] ?? "USERS");
  }

  return (
    <div className="grid max-w-2xl gap-4">
      <form onSubmit={submit} className="grid gap-6 rounded-xl border bg-card p-5">
        {mode === "edit" && source ? <input type="hidden" name="id" value={source.id} /> : null}

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="f-name">Name</Label>
            <Input id="f-name" name="name" defaultValue={source?.name} placeholder="Corporate directory" />
          </div>

          <div className="grid gap-1.5">
            <Label>Type</Label>
            {mode === "create" ? (
              <Combobox
                name="type"
                options={CONFIGURABLE_TYPES.map((s) => ({ value: s.type, label: s.label }))}
                value={type}
                onChange={changeType}
                searchPlaceholder="Search…"
              />
            ) : (
              <p className="text-sm font-medium">{spec.label}</p>
            )}
            <p className="text-xs text-muted-foreground">{spec.blurb}</p>
          </div>

          <div className="grid gap-1.5">
            <Label>Import</Label>
            {mode === "create" && spec.scopes.length > 1 ? (
              <Combobox
                name="scope"
                options={spec.scopes.map((s) => ({ value: s, label: SCOPE_LABELS[s] ?? s }))}
                value={scope}
                onChange={setScope}
                searchPlaceholder="Search…"
              />
            ) : (
              <>
                <p className="text-sm font-medium">{SCOPE_LABELS[scope] ?? scope}</p>
                {mode === "create" ? <input type="hidden" name="scope" value={scope} /> : null}
              </>
            )}
            <p className="text-xs text-muted-foreground">
              What this source imports. Fixed after creation.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="f-schedule">Schedule (cron)</Label>
            <Input id="f-schedule" name="schedule" defaultValue={source?.schedule ?? ""} placeholder="0 * * * *" className="font-mono text-xs" />
            <p className="text-xs text-muted-foreground">
              Optional cron expression — e.g. <code className="font-mono">0 * * * *</code> (hourly),{" "}
              <code className="font-mono">0 2 * * *</code> (daily 02:00). Runs automatically while active. Blank = manual only.
            </p>
          </div>
        </div>

        {/* Remounts on type/scope change so field defaults reload. */}
        <ConnectorFields key={`${type}-${scope}`} spec={spec} scope={scope} values={mode === "edit" ? values : undefined} passwordSet={passwordSet} />

        <div className="flex items-center justify-end gap-2">
          <LinkButton href={mode === "edit" && source ? `/syncs/${source.id}` : "/syncs"} variant="ghost">
            Cancel
          </LinkButton>
          <SubmitButton label={mode === "create" ? "Create source" : "Save changes"} />
        </div>
      </form>

      {mode === "edit" && source ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
          <TestConnectionButton id={source.id} />
          <ConfirmButton
            action={deleteSyncSource}
            fields={{ id: source.id }}
            title="Delete sync source?"
            description={`"${source.name}" will be deleted. Imported users and assets are kept but unlinked from this source.`}
            confirmLabel="Delete source"
            triggerVariant="ghost"
            triggerSize="sm"
            triggerClassName="text-red-600 hover:text-red-600 dark:text-red-400"
          >
            <Trash2 className="size-4" /> Delete source
          </ConfirmButton>
        </div>
      ) : null}
    </div>
  );
}

function TestConnectionButton({ id }: { id: string }) {
  const [state, formAction] = useActionState<
    { error?: string; ok?: boolean; message?: string },
    FormData
  >(testSyncConnection, {});

  useEffect(() => {
    if (state?.ok && state.message) toast.success(state.message);
    else if (state?.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={formAction} className="flex items-center gap-3">
      <input type="hidden" name="id" value={id} />
      <TestSubmit />
      {state?.message && state.ok ? (
        <span className="text-xs text-emerald-600 dark:text-emerald-400">Connection OK</span>
      ) : state?.error ? (
        <span className="max-w-[280px] truncate text-xs text-red-600 dark:text-red-400" title={state.error}>
          {state.error}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">Verify credentials &amp; reachability.</span>
      )}
    </form>
  );
}

function TestSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
      Test connection
    </Button>
  );
}

