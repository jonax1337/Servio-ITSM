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
  Link2,
  Search,
  Settings2,
  ShoppingBag,
  Tags,
  Ticket,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Human, branded one-line activity chips for Sable's READ tools, replacing the
 * generic "Used tool: <name> { …json }" fallback. Labels are derived from the
 * tool INPUT (the query/ref), so they render identically on the streaming ai-sdk
 * path and the buffered claude-code path (which never surfaces tool outputs).
 * Write tools (propose_*) keep their rich approval/confirm cards.
 */

type Args = Record<string, unknown> | undefined;

/** `: "the query"` when the given arg key holds a non-empty string, else "". */
function suffix(a: Args, key: string): string {
  const v = a?.[key];
  return typeof v === "string" && v.trim() ? `: “${v.trim()}”` : "";
}

/** ` REF` when an arg key holds a non-empty string, else "". */
function trailing(a: Args, key: string): string {
  const v = a?.[key];
  return typeof v === "string" && v.trim() ? ` ${v.trim()}` : "";
}

type Meta = { icon: LucideIcon; label: (a: Args) => string };

const TOOLS: Record<string, Meta> = {
  // Knowledge / catalog / web (portal + console)
  search_knowledge: { icon: BookOpen, label: (a) => `Searched the knowledge base${suffix(a, "query")}` },
  category_list: { icon: Tags, label: () => "Listed categories" },
  group_list: { icon: Users, label: () => "Listed teams" },
  search_knowledge_base: { icon: BookOpen, label: (a) => `Searched the knowledge base${suffix(a, "query")}` },
  search_catalog: { icon: ShoppingBag, label: (a) => `Searched the service catalog${suffix(a, "query")}` },
  list_categories: { icon: Tags, label: () => "Listed ticket categories" },
  get_service_form: { icon: FileText, label: () => "Loaded a request form" },
  web_search: { icon: Globe, label: (a) => `Searched the web${suffix(a, "query")}` },
  fetch_url: { icon: Link2, label: () => "Read a web page" },
  draft_document: { icon: FilePen, label: (a) => `Drafted a document${suffix(a, "title")}` },

  // Project library (Sable Projects)
  project_search_files: { icon: FolderSearch, label: (a) => `Searched the project files${suffix(a, "query")}` },
  project_list_files: { icon: Files, label: () => "Listed the project files" },

  // Tickets (portal own-ticket + console)
  list_my_tickets: { icon: Ticket, label: () => "Looked up your tickets" },
  get_my_ticket: { icon: Ticket, label: (a) => `Read ticket${trailing(a, "ref")}` },
  list_tickets: { icon: Ticket, label: () => "Looked up tickets" },
  list_team_tickets: { icon: Ticket, label: () => "Looked up the team's queue" },
  get_ticket: { icon: Ticket, label: (a) => `Read ticket${trailing(a, "ref")}` },
  search_tickets: { icon: Search, label: (a) => `Searched tickets${suffix(a, "query")}` },
  search_problems: { icon: Search, label: (a) => `Searched problems${suffix(a, "query")}` },
  search_changes: { icon: Search, label: (a) => `Searched changes${suffix(a, "query")}` },

  // Admin scope
  get_statistics: {
    icon: BarChart3,
    label: (a) => {
      const m = a?.metric;
      return typeof m === "string" && m.trim() ? `Pulled statistics: ${m.trim()}` : "Pulled statistics";
    },
  },
  get_settings_overview: { icon: Settings2, label: () => "Reviewed configuration" },
  search_people: { icon: Users, label: (a) => `Looked up people${suffix(a, "query")}` },
  search_groups: { icon: Users, label: (a) => `Looked up teams${suffix(a, "query")}` },
  search_categories: { icon: Tags, label: (a) => `Looked up categories${suffix(a, "query")}` },
  search_services: { icon: Boxes, label: (a) => `Looked up services${suffix(a, "query")}` },
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
  const meta = TOOLS[toolName];
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <div className="text-muted-foreground flex items-center gap-2 py-0.5 text-xs">
      <Icon className={cn("text-sable size-3.5 shrink-0", running && "animate-pulse")} />
      <span className="min-w-0 truncate">{meta.label(args)}</span>
    </div>
  );
}
