"use client";

/**
 * Slash-commands + @-mentions for Sable's composer.
 *
 * Built on assistant-ui's DOCUMENTED (though `unstable_`-prefixed / experimental)
 * composer trigger primitives, present in the pinned `@assistant-ui/react`
 * (0.15.13): `ComposerPrimitive.Unstable_TriggerPopover*` together with the
 * `unstable_useSlashCommandAdapter` and `unstable_useLiveCompletionAdapter`
 * adapter hooks. Using the first-party primitive keeps streaming, send, IME
 * composition, attachments and dictation fully intact — the popover is driven by
 * the composer's own text state rather than a hand-rolled overlay that would have
 * to re-implement caret tracking and key handling.
 *
 * Both triggers use the `Action` behavior (never `Directive`), so what lands in
 * the composer is PLAIN TEXT:
 *   - `/command`  → `removeOnExecute` strips the typed `/cmd`, then `execute`
 *     writes the ITSM prompt template into the composer (ready to edit / send).
 *   - `@mention`  → a plain-text `formatter` splices the record's readable
 *     reference (a ticket's ref like `INC-89`, a change's `CHG-104`, or a
 *     person's / service's name) in place of the `@query`. No custom token
 *     format — Sable's server tools already resolve refs and names, so this
 *     works regardless of the configured provider.
 */

import { useMemo } from "react";
import {
  ComposerPrimitive,
  unstable_useLiveCompletionAdapter,
  unstable_useSlashCommandAdapter,
  useAui,
  useAuiState,
  type Unstable_DirectiveFormatter,
  type Unstable_SlashCommand,
  type Unstable_TriggerItem,
} from "@assistant-ui/react";
import {
  BoxIcon,
  FileTextIcon,
  GitPullRequestArrowIcon,
  LifeBuoyIcon,
  ListChecksIcon,
  type LucideIcon,
  RotateCcwIcon,
  ScrollTextIcon,
  SearchIcon,
  ServerIcon,
  TicketIcon,
  UserIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

/* ------------------------------------------------------------------ *
 *  1. Slash commands — ITSM prompt templates
 * ------------------------------------------------------------------ */

/**
 * The prompt library surfaced by `/` at the start of the composer. Extensible:
 * add `{ command, label, description, template }` entries; `template` is the
 * full prompt inserted into the composer, ready to edit or send.
 */
export type SableSlashTemplate = {
  readonly command: string;
  readonly label: string;
  readonly description: string;
  readonly template: string;
  readonly icon: LucideIcon;
};

export const SABLE_SLASH_TEMPLATES: readonly SableSlashTemplate[] = [
  {
    command: "summarise",
    label: "/summarise",
    description: "Summarise the ticket/thread and recommend the next action",
    icon: FileTextIcon,
    template:
      "Summarise this ticket/thread: the situation, what's been tried, and the current blocker. Then recommend the next action.",
  },
  {
    command: "rca",
    label: "/rca",
    description: "Draft a root-cause analysis",
    icon: SearchIcon,
    template:
      "Draft a concise root-cause analysis (problem statement, timeline, root cause, contributing factors, corrective + preventive actions).",
  },
  {
    command: "rollback",
    label: "/rollback",
    description: "Draft a rollback plan for this change",
    icon: RotateCcwIcon,
    template:
      "Draft a step-by-step rollback plan for this change, including validation checks and the go/no-go criteria.",
  },
  {
    command: "runbook",
    label: "/runbook",
    description: "Write a runbook for this change/task",
    icon: ScrollTextIcon,
    template:
      "Write a runbook for this change/task: prerequisites, numbered steps, verification, and rollback.",
  },
  {
    command: "triage",
    label: "/triage",
    description: "Triage: category, priority, impact/urgency, team",
    icon: ListChecksIcon,
    template:
      "Triage this ticket: propose category, priority, impact/urgency, and the right team, with a one-line justification each.",
  },
  {
    command: "kb",
    label: "/kb",
    description: "Draft a knowledge-base article from this ticket",
    icon: LifeBuoyIcon,
    template:
      "Draft a knowledge-base article from this ticket's problem + resolution (title, symptoms, cause, resolution, prevention).",
  },
];

/* ------------------------------------------------------------------ *
 *  2. @-mentions — live search against /api/search
 * ------------------------------------------------------------------ */

type SearchKind =
  | "ticket"
  | "problem"
  | "change"
  | "asset"
  | "user"
  | "service";

type SearchResult = {
  readonly kind: SearchKind;
  readonly id: number | string;
  readonly title: string;
  readonly sub: string;
  readonly group: string;
};

const KIND_ICON: Record<SearchKind, LucideIcon> = {
  ticket: TicketIcon,
  problem: LifeBuoyIcon,
  change: GitPullRequestArrowIcon,
  asset: BoxIcon,
  user: UserIcon,
  service: ServerIcon,
};

/**
 * The readable reference we splice into the composer for a mention. For
 * tickets/problems/changes the search API's `sub` already carries the ref
 * (e.g. `INC-89`, `PRB-12`, `CHG-104`); people, assets and services resolve by
 * their display name/title. Sable's server tools accept both forms.
 */
function mentionText(r: SearchResult): string {
  switch (r.kind) {
    case "ticket":
    case "problem":
    case "change":
      return r.sub;
    default:
      return r.title;
  }
}

const ICON_KEYS = Object.keys(KIND_ICON) as SearchKind[];

/** Turn a search result into an assistant-ui trigger item (kind carried in metadata). */
function toTriggerItem(r: SearchResult): Unstable_TriggerItem {
  return {
    id: `${r.kind}:${r.id}`,
    type: "mention",
    label: r.title,
    description: r.sub,
    metadata: {
      kind: r.kind,
      text: mentionText(r),
    },
  };
}

function iconForItem(item: Unstable_TriggerItem): LucideIcon {
  const kind = item.metadata?.kind;
  if (typeof kind === "string" && (ICON_KEYS as string[]).includes(kind)) {
    return KIND_ICON[kind as SearchKind];
  }
  return SearchIcon;
}

/* ------------------------------------------------------------------ *
 *  Popover chrome (shared)
 * ------------------------------------------------------------------ */

const POPOVER_CLASS = cn(
  "absolute bottom-full left-0 z-50 mb-2 max-h-72 w-72 overflow-y-auto",
  "rounded-xl border bg-popover/95 p-1.5 text-popover-foreground shadow-lg backdrop-blur-sm",
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-1",
);

const ITEM_CLASS = cn(
  "flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left outline-none select-none",
  "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
);

/* ------------------------------------------------------------------ *
 *  Component
 * ------------------------------------------------------------------ */

/**
 * Renders the two composer triggers. Mount as a child of
 * `ComposerPrimitive.Unstable_TriggerPopoverRoot` (which itself wraps the
 * `ComposerPrimitive.Root`), so its popovers anchor to the composer input.
 */
export function ComposerCommands() {
  const aui = useAui();
  const t = useT("assistant");
  const text = useAuiState((s) => s.composer.text);

  // Slash templates are only meaningful at the very start of the composer (a
  // fresh prompt). Disable the trigger once the message is under way so a stray
  // "/" mid-sentence never hijacks typing.
  const slashEnabled = text.length === 0 || text.startsWith("/");

  const slashCommands = useMemo<readonly Unstable_SlashCommand[]>(
    () =>
      SABLE_SLASH_TEMPLATES.map((tpl) => ({
        id: tpl.command,
        label: tpl.label,
        // The template becomes the user's own message, so it follows their language too.
        description: t.dyn(`slash.${tpl.command}.description`, undefined, tpl.description),
        execute: () => {
          // `removeOnExecute` has already stripped the typed `/cmd`; drop in the
          // full prompt template, ready for the user to edit or send.
          aui.composer.setText(t.dyn(`slash.${tpl.command}.template`, undefined, tpl.template));
        },
      })),
    [aui, t],
  );

  const slash = unstable_useSlashCommandAdapter({
    commands: slashEnabled ? slashCommands : [],
    removeOnExecute: true,
  });

  // Debounced live search against the global search API. The adapter itself
  // caches the last-resolved items and re-runs the popover lookup only when a
  // fresh fetch lands, so out-of-order responses are already reconciled to the
  // current query — no manual request-sequencing needed here.
  const mentions = unstable_useLiveCompletionAdapter({
    debounceMs: 200,
    fetcher: async (query) => {
      const q = query.trim();
      if (!q) return [];
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          headers: { accept: "application/json" },
        });
        if (!res.ok) return [];
        const data = (await res.json()) as { results?: SearchResult[] };
        return (data.results ?? []).map(toTriggerItem);
      } catch {
        return [];
      }
    },
  });

  // Plain-text formatter: what lands in the composer for a mention is the
  // record's ref/name (NOT a `:tool[…]{…}` directive), so Sable's server tools
  // resolve it directly. `parse` is unused for insertion but kept for interface
  // completeness.
  const mentionFormatter = useMemo<Unstable_DirectiveFormatter>(
    () => ({
      serialize: (item) => {
        const text = item.metadata?.text;
        return typeof text === "string" ? text : item.label;
      },
      parse: () => [],
    }),
    [],
  );

  return (
    <>
      <ComposerPrimitive.Unstable_TriggerPopover
        char="/"
        adapter={slash.adapter}
        className={POPOVER_CLASS}
      >
        <ComposerPrimitive.Unstable_TriggerPopover.Action {...slash.action} />
        {/* Everything visible lives INSIDE TriggerPopoverItems, which renders only
            while the popover is open. A direct child would otherwise be rendered
            raw (unwrapped, in normal flow) beneath the composer when closed. */}
        <ComposerPrimitive.Unstable_TriggerPopoverItems>
          {(items) => (
            <>
              <div className="text-muted-foreground px-2.5 pt-0.5 pb-1.5 text-[11px] font-medium tracking-wide uppercase">
                {t("slash.prompts")}
              </div>
              {items.map((item, index) => {
                const tpl = SABLE_SLASH_TEMPLATES.find(
                  (tpl) => tpl.command === item.id,
                );
                const Icon = tpl?.icon ?? SearchIcon;
                return (
                  <ComposerPrimitive.Unstable_TriggerPopoverItem
                    key={item.id}
                    item={item}
                    index={index}
                    className={ITEM_CLASS}
                  >
                    <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {item.label}
                      </span>
                      {item.description ? (
                        <span className="text-muted-foreground block truncate text-xs">
                          {item.description}
                        </span>
                      ) : null}
                    </span>
                  </ComposerPrimitive.Unstable_TriggerPopoverItem>
                );
              })}
            </>
          )}
        </ComposerPrimitive.Unstable_TriggerPopoverItems>
      </ComposerPrimitive.Unstable_TriggerPopover>

      <ComposerPrimitive.Unstable_TriggerPopover
        char="@"
        adapter={mentions.adapter}
        isLoading={mentions.isLoading}
        className={POPOVER_CLASS}
      >
        <ComposerPrimitive.Unstable_TriggerPopover.Action
          formatter={mentionFormatter}
          onExecute={() => {
            /* insertion is handled by the plain-text formatter */
          }}
        />
        <ComposerPrimitive.Unstable_TriggerPopoverItems>
          {(items) =>
            items.length === 0 ? (
              <div className="text-muted-foreground px-2.5 py-3 text-center text-xs">
                {mentions.isLoading ? t("mentions.searching") : t("mentions.noMatches")}
              </div>
            ) : (
              items.map((item, index) => {
                const Icon = iconForItem(item);
                return (
                  <ComposerPrimitive.Unstable_TriggerPopoverItem
                    key={item.id}
                    item={item}
                    index={index}
                    className={ITEM_CLASS}
                  >
                    <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {item.label}
                      </span>
                      {item.description ? (
                        <span className="text-muted-foreground block truncate text-xs">
                          {item.description}
                        </span>
                      ) : null}
                    </span>
                  </ComposerPrimitive.Unstable_TriggerPopoverItem>
                );
              })
            )
          }
        </ComposerPrimitive.Unstable_TriggerPopoverItems>
      </ComposerPrimitive.Unstable_TriggerPopover>
    </>
  );
}
