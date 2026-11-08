"use client";

import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BookOpen,
  Boxes,
  FileText,
  FilePen,
  FolderSearch,
  Files,
  Globe,
  GraduationCap,
  Link2,
  Search,
  Settings2,
  ShoppingBag,
  Tags,
  Ticket,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import type { Translator } from "@/lib/i18n/translate";

/**
 * Human, branded one-line activity chips for Sable's READ tools, replacing the
 * generic "Used tool: <name> { …json }" fallback. Labels are derived from the
 * tool INPUT (the query/ref), so they render identically on the streaming ai-sdk
 * path and the buffered claude-code path (which never surfaces tool outputs).
 * Write tools (propose_*) keep their rich approval/confirm cards.
 */

type Args = Record<string, unknown> | undefined;

type T = Translator<"assistant">;

/** `: "the query"` when the given arg key holds a non-empty string, else "". */
function suffix(a: Args, key: string, t: T): string {
  const v = a?.[key];
  return typeof v === "string" && v.trim() ? t("activity.querySuffix", { value: v.trim() }) : "";
}

/** ` REF` when an arg key holds a non-empty string, else "". */
function trailing(a: Args, key: string): string {
  const v = a?.[key];
  return typeof v === "string" && v.trim() ? ` ${v.trim()}` : "";
}

type Meta = { icon: LucideIcon; label: (a: Args, t: T) => string };

const TOOLS: Record<string, Meta> = {
  // Knowledge / catalog / web (portal + console)
  search_knowledge: { icon: BookOpen, label: (a, t) => t("activity.searchKb") + suffix(a, "query", t) },
  category_list: { icon: Tags, label: (_a, t) => t("activity.listCategories") },
  group_list: { icon: Users, label: (_a, t) => t("activity.listTeams") },
  search_knowledge_base: { icon: BookOpen, label: (a, t) => t("activity.searchKb") + suffix(a, "query", t) },
  search_catalog: { icon: ShoppingBag, label: (a, t) => t("activity.searchCatalog") + suffix(a, "query", t) },
  list_categories: { icon: Tags, label: (_a, t) => t("activity.listTicketCategories") },
  get_service_form: { icon: FileText, label: (_a, t) => t("activity.loadForm") },
  web_search: { icon: Globe, label: (a, t) => t("activity.searchWeb") + suffix(a, "query", t) },
  fetch_url: { icon: Link2, label: (_a, t) => t("activity.readPage") },
  draft_document: { icon: FilePen, label: (a, t) => t("activity.draftDocument") + suffix(a, "title", t) },
  // Sable loading one of its ITSM skills (sable/skills) in the Claude Code harness
  use_skill: { icon: GraduationCap, label: (a, t) => t("activity.applySkill") + suffix(a, "skill", t) },

  // Project library (Sable Projects)
  project_search_files: { icon: FolderSearch, label: (a, t) => t("activity.searchProjectFiles") + suffix(a, "query", t) },
  project_list_files: { icon: Files, label: (_a, t) => t("activity.listProjectFiles") },

  // Tickets (portal own-ticket + console)
  list_my_tickets: { icon: Ticket, label: (_a, t) => t("activity.myTickets") },
  get_my_ticket: { icon: Ticket, label: (a, t) => t("activity.readTicket") + trailing(a, "ref") },
  list_tickets: { icon: Ticket, label: (_a, t) => t("activity.tickets") },
  list_team_tickets: { icon: Ticket, label: (_a, t) => t("activity.teamQueue") },
  get_ticket: { icon: Ticket, label: (a, t) => t("activity.readTicket") + trailing(a, "ref") },
  search_tickets: { icon: Search, label: (a, t) => t("activity.searchTickets") + suffix(a, "query", t) },
  search_problems: { icon: Search, label: (a, t) => t("activity.searchProblems") + suffix(a, "query", t) },
  search_changes: { icon: Search, label: (a, t) => t("activity.searchChanges") + suffix(a, "query", t) },

  // Admin scope
  get_statistics: {
    icon: BarChart3,
    label: (a, t) => {
      const m = a?.metric;
      return typeof m === "string" && m.trim() ? t("activity.statisticsMetric", { metric: m.trim() }) : t("activity.statistics");
    },
  },
  get_settings_overview: { icon: Settings2, label: (_a, t) => t("activity.settings") },
  search_people: { icon: Users, label: (a, t) => t("activity.people") + suffix(a, "query", t) },
  search_groups: { icon: Users, label: (a, t) => t("activity.teams") + suffix(a, "query", t) },
  search_categories: { icon: Tags, label: (a, t) => t("activity.categories") + suffix(a, "query", t) },
  search_services: { icon: Boxes, label: (a, t) => t("activity.services") + suffix(a, "query", t) },
};

/** Whether a branded chip exists for this tool. */
export function hasToolActivity(toolName: string): boolean {
  return toolName in TOOLS;
}

/** A compact, human "what Sable did" line for a read tool. */
export function ToolActivityChip({
  toolName,
  args,
  running,
}: {
  toolName: string;
  args: Args;
  running?: boolean;
}) {
  const t = useT("assistant");
  const meta = TOOLS[toolName];
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <div className="text-muted-foreground flex items-center gap-2 py-0.5 text-xs">
      <Icon className={cn("text-sable size-3.5 shrink-0", running && "animate-pulse")} />
      <span className="min-w-0 truncate">{meta.label(args, t)}</span>
    </div>
  );
}
