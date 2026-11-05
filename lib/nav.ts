import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Ticket,
  AlertTriangle,
  GitPullRequestArrow,
  Server,
  Boxes,
  Users,
  FolderTree,
  RefreshCw,
  BookOpen,
  Settings,
  LifeBuoy,
  CheckSquare,
  Zap,
  MapPin,
  ShoppingBag,
  ScrollText,
  MessageSquareText,
} from "lucide-react";
import { SableMark } from "@/components/sable-mark";
import { AI_ASSISTANT_NAME } from "@/lib/constants";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  minRole?: "AGENT" | "MANAGER" | "ADMIN";
};

export type NavGroup = { label: string; items: NavItem[] };

export const consoleNav: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { title: "Dashboard", href: "/", icon: LayoutDashboard },
      { title: AI_ASSISTANT_NAME, href: "/assistant", icon: SableMark },
    ],
  },
  {
    label: "Service Desk",
    items: [
      { title: "Tickets", href: "/tickets", icon: Ticket },
      { title: "Problems", href: "/problems", icon: AlertTriangle },
      { title: "Changes", href: "/changes", icon: GitPullRequestArrow },
      { title: "Approvals", href: "/approvals", icon: CheckSquare },
      { title: "Knowledge Base", href: "/knowledge", icon: BookOpen },
    ],
  },
  {
    label: "Catalog",
    items: [
      { title: "Services", href: "/services", icon: LifeBuoy },
      { title: "Service Catalog", href: "/catalog", icon: ShoppingBag, minRole: "MANAGER" },
    ],
  },
  {
    label: "CMDB",
    items: [
      { title: "Assets", href: "/assets", icon: Server },
      { title: "Locations", href: "/locations", icon: MapPin },
    ],
  },
  {
    label: "Organisation",
    items: [
      { title: "Groups", href: "/groups", icon: Users },
      { title: "People", href: "/people", icon: Boxes },
      { title: "Categories", href: "/categories", icon: FolderTree },
    ],
  },
  {
    label: "Administration",
    items: [
      { title: "Automations", href: "/automations", icon: Zap, minRole: "MANAGER" },
      // Agents manage their OWN personal macros (matching the server actions);
      // sharing a macro org-wide stays MANAGER+ (MacroManager gates the toggle).
      { title: "Macros", href: "/settings/macros", icon: MessageSquareText },
      { title: "Syncs", href: "/syncs", icon: RefreshCw, minRole: "MANAGER" },
      { title: "Audit Log", href: "/audit", icon: ScrollText, minRole: "ADMIN" },
      { title: "Settings", href: "/settings", icon: Settings, minRole: "MANAGER" },
    ],
  },
];

const RANK = { USER: 0, AGENT: 1, MANAGER: 2, ADMIN: 3 } as const;

export function filterNav(nav: NavGroup[], role: string): NavGroup[] {
  const r = RANK[role as keyof typeof RANK] ?? 0;
  return nav
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (i) => !i.minRole || r >= RANK[i.minRole],
      ),
    }))
    .filter((g) => g.items.length > 0);
}
