import Link from "next/link";
import {
  Settings,
  KeyRound,
  RefreshCw,
  FolderTree,
  Users,
  Timer,
  Zap,
  ArrowUpRight,
  Info,
  Palette,
  Mail,
  Inbox,
  MailCheck,
  UploadCloud,
  Workflow,
  MessageSquareText,
  SlidersHorizontal,
  ArrowUpCircle,
  Repeat,
} from "lucide-react";
import type { Metadata } from "next";
import type { LucideIcon } from "lucide-react";
import { requireRole } from "@/lib/session";
import { APP_VERSION } from "@/lib/constants";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SableMark } from "@/components/sable-mark";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

type SettingCard = {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** Minimum role to OPEN the target page — cards above the viewer's role are hidden. */
  minRole?: "AGENT" | "MANAGER" | "ADMIN";
};

const CARDS: SettingCard[] = [
  {
    href: "/settings/general",
    title: "General & Branding",
    description: "Application name and public URL used across the app and emails.",
    icon: Palette,
    minRole: "ADMIN",
  },
  {
    href: "/settings/email",
    title: "Email (SMTP)",
    description: "Configure outgoing mail delivery, or run in outbox mode.",
    icon: Mail,
    minRole: "ADMIN",
  },
  {
    href: "/settings/inbound",
    title: "Inbound Mail (IMAP)",
    description: "Poll a shared mailbox so replies become ticket comments.",
    icon: Inbox,
    minRole: "ADMIN",
  },
  {
    href: "/settings/email-templates",
    title: "Email Templates",
    description: "Edit the subject and content of the ticket emails users receive.",
    icon: MailCheck,
    minRole: "ADMIN",
  },
  {
    href: "/settings/ai",
    title: "Sable (AI assistant)",
    description: "Provider, model and API keys for the built-in AI assistant.",
    icon: SableMark,
    minRole: "ADMIN",
  },
  {
    href: "/settings/uploads",
    title: "Uploads",
    description: "File attachment size limits for tickets, comments and articles.",
    icon: UploadCloud,
    minRole: "ADMIN",
  },
  {
    href: "/settings/updates",
    title: "Updates & Maintenance",
    description: "Update Servio from GitHub releases and plan maintenance windows with advance notice.",
    icon: ArrowUpCircle,
    minRole: "ADMIN",
  },
  {
    href: "/settings/sla",
    title: "SLA Policies",
    description: "Define response and resolution targets and how the clock is applied.",
    icon: Timer,
    minRole: "MANAGER",
  },
  {
    href: "/settings/workflows",
    title: "Status Workflows",
    description: "Control allowed status changes per entity and gate transitions behind a role.",
    icon: Workflow,
    minRole: "MANAGER",
  },
  {
    href: "/settings/custom-fields",
    title: "Custom Fields",
    description: "Add admin-defined fields to tickets, problems and changes with conditional visibility.",
    icon: SlidersHorizontal,
    minRole: "MANAGER",
  },
  {
    href: "/settings/recurring-tickets",
    title: "Recurring Tickets",
    description: "Create tickets on a schedule for routine work like renewals, reviews and restore tests.",
    icon: Repeat,
    minRole: "MANAGER",
  },
  {
    href: "/settings/mail",
    title: "Mail Log",
    description: "Inspect the outbox and every processed inbound message.",
    icon: Mail,
    minRole: "MANAGER",
  },
  {
    href: "/automations",
    title: "Automations",
    description: "Build rules that route, prioritise and act on tickets automatically.",
    icon: Zap,
    minRole: "MANAGER",
  },
  {
    href: "/settings/macros",
    title: "Macros",
    description: "One-click action bundles — shared org-wide or personal to an agent.",
    icon: MessageSquareText,
    minRole: "AGENT",
  },
  {
    href: "/settings/api",
    title: "API Tokens",
    description: "Create and revoke personal access tokens for the REST API.",
    icon: KeyRound,
    minRole: "ADMIN",
  },
  {
    href: "/syncs",
    title: "Syncs",
    description: "Connect directories and external systems to import data.",
    icon: RefreshCw,
    minRole: "MANAGER",
  },
  {
    href: "/categories",
    title: "Categories",
    description: "Organise tickets, problems, changes and assets by category.",
    icon: FolderTree,
    minRole: "AGENT",
  },
  {
    href: "/people",
    title: "People",
    description: "Manage users, roles and group memberships.",
    icon: Users,
    minRole: "AGENT",
  },
];

const RANK = { AGENT: 1, MANAGER: 2, ADMIN: 3 } as const;

export default async function SettingsPage() {
  const me = await requireRole("MANAGER");
  // Only show cards the viewer can actually open — a card that redirects to
  // /no-access is a dead end (mirrors lib/nav.ts's filterNav ranks).
  const visible = CARDS.filter(
    (c) => !c.minRole || RANK[me.role as keyof typeof RANK] >= RANK[c.minRole],
  );

  return (
    <>
      <PageHeader
        icon={Settings}
        title="Settings"
        description="Configure your workspace, integrations and access."
      />

      <PageBody className="grid gap-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((card) => (
            <Link key={card.href} href={card.href} className="group block">
              <Card className="h-full transition-colors group-hover:ring-primary/30">
                <CardHeader className="flex-row items-start justify-between">
                  <div className="grid size-9 place-items-center rounded-lg border bg-card text-primary">
                    <card.icon className="size-4.5" />
                  </div>
                  <ArrowUpRight className="size-4 text-muted-foreground transition-colors group-hover:text-primary" />
                </CardHeader>
                <CardContent className="grid gap-1">
                  <CardTitle>{card.title}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {card.description}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <Card>
          <CardHeader className="flex-row items-center gap-2">
            <Info className="size-4 text-muted-foreground" />
            <CardTitle>About Servio</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2.5 text-sm">
            <div className="flex items-center justify-between gap-2 border-b pb-2.5">
              <span className="text-muted-foreground">Application</span>
              <span className="font-medium">Servio</span>
            </div>
            <div className="flex items-center justify-between gap-2 border-b pb-2.5">
              <span className="text-muted-foreground">Version</span>
              <span className="font-mono text-xs">{APP_VERSION}</span>
            </div>
            <div className="flex items-center justify-between gap-2 border-b pb-2.5">
              <span className="text-muted-foreground">License</span>
              <span className="font-medium">MIT</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Signed in as</span>
              <span className="font-medium">{me.email}</span>
            </div>
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
