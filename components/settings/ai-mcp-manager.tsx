"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Pencil, Plus, PlugZap, Save, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  deleteMcpServer,
  saveMcpServer,
  testMcpServer,
  type McpServerView,
} from "@/lib/actions/sable-mcp";
import {
  AI_ASSISTANT_NAME,
  AI_MCP_MODE_META,
  AI_MCP_MODES,
  AI_MCP_TRANSPORTS,
  type AiMcpMode,
  type AiMcpTransport,
} from "@/lib/constants";
import { MCP_MIN_ROLES, type McpMinRole, type McpServerInput, type RemoteMcpTool } from "@/lib/sable-mcp-policy";
import { cn } from "@/lib/utils";

/**
 * What the settings page passes in: `servers` from `listMcpServers()`
 * (lib/actions/sable-mcp.ts) and `allowExternal` = the AI_ALLOW_EXTERNAL setting.
 */
export type AiMcpManagerProps = { servers: McpServerView[]; allowExternal: boolean };

const TRANSPORT_LABEL: Record<AiMcpTransport, string> = { http: "Streamable HTTP", sse: "SSE (legacy)" };
const ROLE_LABEL: Record<McpMinRole, string> = { AGENT: "Agents", MANAGER: "Managers", ADMIN: "Admins" };

/** What Sable does with a non-read-only tool under each mode. */
const WRITE_TOOL_OUTCOME: Record<AiMcpMode, string> = {
  READ_ONLY: "Blocked",
  APPROVAL: "Needs approval",
  TRUSTED: "Runs directly",
};

type Editor = { server: McpServerView | null };

function Pill({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "sable" | "warn" }) {
  const tones = {
    muted: "bg-muted text-muted-foreground",
    sable: "bg-sable-muted text-sable",
    warn: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  };
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", tones[tone])}>{children}</span>;
}

/** Remote MCP servers Sable may use in the console chat (Settings › Sable). */
export function AiMcpManager({ servers, allowExternal }: AiMcpManagerProps) {
  const [editor, setEditor] = useState<Editor | null>(null);

  return (
    <div className="grid gap-3">
      {allowExternal ? null : (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            An MCP server is an external destination: {AI_ASSISTANT_NAME} only uses these servers while
            &ldquo;Allow external providers&rdquo; (Privacy &amp; behaviour) is on. You can configure and
            test them now.
          </span>
        </p>
      )}

      {servers.length ? (
        <ul className="grid gap-2">
          {servers.map((server) => (
            <ServerRow key={server.id} server={server} onEdit={() => setEditor({ server })} />
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
          No MCP servers yet. Add a remote server (HTTP or SSE) to give {AI_ASSISTANT_NAME} its tools.
        </p>
      )}

      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => setEditor({ server: null })}>
          <Plus className="size-4" /> Add server
        </Button>
      </div>

      <Dialog open={editor !== null} onOpenChange={(open) => (open ? null : setEditor(null))}>
        <DialogContent className="sm:max-w-xl">
          {editor ? <ServerEditor server={editor.server} onClose={() => setEditor(null)} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ServerRow({ server, onEdit }: { server: McpServerView; onEdit: () => void }) {
  return (
    <li className="flex items-center gap-3 rounded-lg border p-3">
      <div className="grid min-w-0 flex-1 gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate font-mono text-xs font-medium">{server.name}</span>
          <Pill tone="sable">{AI_MCP_MODE_META[server.mode].label}</Pill>
          <Pill>{ROLE_LABEL[server.minRole]}+</Pill>
          {server.enabled ? null : <Pill tone="warn">Disabled</Pill>}
        </div>
        <span className="truncate text-xs text-muted-foreground">
          {server.url} · {TRANSPORT_LABEL[server.transport]}
          {server.headerNames.length ? ` · headers: ${server.headerNames.join(", ")}` : ""}
        </span>
      </div>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${server.name}`} onClick={onEdit}>
        <Pencil className="size-3.5" />
      </Button>
      <ConfirmButton
        action={deleteMcpServer}
        fields={{ id: server.id }}
        title={`Remove "${server.name}"?`}
        description={`${AI_ASSISTANT_NAME} will no longer see this server's tools, and pending approvals for it will fail.`}
        triggerVariant="ghost"
        triggerLabel={`Remove ${server.name}`}
        successMessage="MCP server removed."
      />
    </li>
  );
}

type HeaderRow = { key: number; name: string; value: string; stored: boolean };

/** Mounted only while the dialog is open, so every opening starts from fresh state. */
function ServerEditor({ server, onClose }: { server: McpServerView | null; onClose: () => void }) {
  const router = useRouter();
  const [saving, startSave] = useTransition();
  const [testing, startTest] = useTransition();
  const [name, setName] = useState(server?.name ?? "");
  const [url, setUrl] = useState(server?.url ?? "");
  const [transport, setTransport] = useState<AiMcpTransport>(server?.transport ?? "http");
  const [mode, setMode] = useState<AiMcpMode>(server?.mode ?? "APPROVAL");
  const [minRole, setMinRole] = useState<McpMinRole>(server?.minRole ?? "AGENT");
  const [enabled, setEnabled] = useState(server?.enabled ?? true);
  const [headers, setHeaders] = useState<HeaderRow[]>(
    () => server?.headerNames.map((n, i) => ({ key: i, name: n, value: "", stored: true })) ?? [],
  );
  const [tools, setTools] = useState<RemoteMcpTool[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const input = (): McpServerInput => ({
    id: server?.id,
    name: name.trim(),
    url: url.trim(),
    transport,
    mode,
    minRole,
    enabled,
    headers: headers.filter((h) => h.name.trim()).map((h) => ({ name: h.name.trim(), value: h.value })),
  });

  const updateHeader = (key: number, patch: Partial<HeaderRow>) =>
    setHeaders((rows) => rows.map((h) => (h.key === key ? { ...h, ...patch } : h)));
  const addHeader = () =>
    setHeaders((rows) => [...rows, { key: Date.now(), name: "", value: "", stored: false }]);

  const test = () =>
    startTest(async () => {
      setError(null);
      const result = await testMcpServer(input());
      if (result.ok) setTools(result.tools);
      else {
        setTools(null);
        setError(result.error);
      }
    });

  const save = () =>
    startSave(async () => {
      const result = await saveMcpServer(input());
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(server ? "MCP server saved." : "MCP server added.");
      onClose();
      router.refresh();
    });

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <PlugZap className="size-4 text-sable" /> {server ? "Edit MCP server" : "Add MCP server"}
        </DialogTitle>
        <DialogDescription>
          A remote MCP server whose tools {AI_ASSISTANT_NAME} can use in the console chat. Never offered in the
          self-service portal.
        </DialogDescription>
      </DialogHeader>

      <div className="grid max-h-[65vh] gap-4 overflow-y-auto pr-1">
        <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
          <div className="grid gap-1.5">
            <Label htmlFor="mcp-name">Name</Label>
            <Input
              id="mcp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="github"
              className="font-mono"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mcp-url">URL</Label>
            <Input
              id="mcp-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://mcp.example.com/mcp"
            />
          </div>
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">
          Lowercase letters and digits, optionally joined by - or _. The model sees the tools as
          <code className="mx-1 font-mono">mcp__{name.trim() || "name"}__tool</code>.
        </p>

        <ChoiceRow
          label="Transport"
          options={AI_MCP_TRANSPORTS.map((t) => ({ value: t, label: TRANSPORT_LABEL[t] }))}
          value={transport}
          onChange={setTransport}
        />

        <div className="grid gap-1.5">
          <div className="flex items-center justify-between">
            <Label>Headers</Label>
            <Button type="button" variant="ghost" size="sm" onClick={addHeader}>
              <Plus className="size-3.5" /> Add header
            </Button>
          </div>
          {headers.length ? (
            <div className="grid gap-2">
              {headers.map((h) => (
                <div key={h.key} className="flex items-center gap-2">
                  <Input
                    aria-label="Header name"
                    value={h.name}
                    onChange={(e) => updateHeader(h.key, { name: e.target.value })}
                    placeholder="Authorization"
                    className="w-2/5 font-mono text-xs"
                  />
                  <Input
                    aria-label={`Value of ${h.name || "header"}`}
                    type="password"
                    autoComplete="new-password"
                    value={h.value}
                    onChange={(e) => updateHeader(h.key, { value: e.target.value })}
                    placeholder={h.stored ? "Unchanged (stored encrypted)" : "Value"}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove header ${h.name}`}
                    onClick={() => setHeaders((rows) => rows.filter((r) => r.key !== h.key))}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            E.g. an API token. Values are stored encrypted and never shown again; leave a value blank to keep it
            (only while the URL stays on the same host).
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label>Mode</Label>
          <div className="grid gap-2 sm:grid-cols-3">
            {AI_MCP_MODES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={cn(
                  "grid gap-0.5 rounded-lg border p-2.5 text-left transition-colors",
                  mode === m ? "border-sable bg-sable-muted/40" : "hover:bg-muted/50",
                )}
              >
                <span className="text-sm font-medium">{AI_MCP_MODE_META[m].label}</span>
                <span className="text-xs text-muted-foreground">{AI_MCP_MODE_META[m].description}</span>
              </button>
            ))}
          </div>
        </div>

        <ChoiceRow
          label="Available to"
          options={MCP_MIN_ROLES.map((r) => ({ value: r, label: `${ROLE_LABEL[r]} and above` }))}
          value={minRole}
          onChange={setMinRole}
        />

        <label className="flex items-center gap-2 text-sm">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          Enabled
        </label>

        {tools ? <ToolList tools={tools} mode={mode} /> : null}

        {error ? (
          <p className="flex items-start gap-1.5 rounded-lg bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0">{error}</span>
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={test} disabled={testing || saving || !url.trim()}>
          {testing ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
          Test connection
        </Button>
        <Button type="button" onClick={save} disabled={saving || !name.trim() || !url.trim()}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

function ChoiceRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <Button
            key={o.value}
            type="button"
            size="sm"
            variant={value === o.value ? "default" : "outline"}
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** The tools a test connection found, with what the selected mode does to each. */
function ToolList({ tools, mode }: { tools: RemoteMcpTool[]; mode: AiMcpMode }) {
  if (!tools.length) {
    return <p className="rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">Connected — the server lists no tools.</p>;
  }
  return (
    <div className="grid gap-1.5">
      <Label>
        {tools.length} {tools.length === 1 ? "tool" : "tools"}
      </Label>
      <ul className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border p-2">
        {tools.map((t) => (
          <li key={t.name} className="flex items-start justify-between gap-2 py-0.5">
            <div className="grid min-w-0 gap-0.5">
              <span className="truncate font-mono text-xs">{t.name}</span>
              {t.description ? (
                <span className="line-clamp-1 text-[11px] text-muted-foreground">{t.description}</span>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-1">
              {t.readOnly ? (
                <Pill tone="sable">Read-only</Pill>
              ) : (
                <>
                  <Pill>Writes</Pill>
                  <Pill tone={mode === "TRUSTED" ? "warn" : "muted"}>{WRITE_TOOL_OUTCOME[mode]}</Pill>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
