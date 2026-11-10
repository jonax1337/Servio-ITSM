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
  CalendarRange,
  Rocket,
  PhoneCall,
  Activity,
  FileSignature,
  Lightbulb,
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

/**
 * Translation keys for nav entries (messages/<locale>/nav.ts): an item by its href, a group
 * by `group.<label>`. The English `title`/`label` stays the fallback, so an entry without a
 * translation still renders.
 */
export const navItemKey = (item: Pick<NavItem, "href">) => item.href;
export const navGroupKey = (group: Pick<NavGroup, "label">) => `group.${group.label}`;

export const consoleNav: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { title: "Dashboard", href: "/", icon: LayoutDashboard },
      { title: AI_ASSISTANT_NAME, href: "/assistant", icon: SableMark },
      { title: "Insights", href: "/insights", icon: Lightbulb },
    ],
  },
  {
    label: "Service Desk",
    items: [
      { title: "Tickets", href: "/tickets", icon: Ticket },
      { title: "Problems", href: "/problems", icon: AlertTriangle },
      { title: "Approvals", href: "/approvals", icon: CheckSquare },
      { title: "Knowledge Base", href: "/knowledge", icon: BookOpen },
    ],
  },
  {
    label: "Change & Release",
    items: [
      { title: "Changes", href: "/changes", icon: GitPullRequestArrow },
      { title: "Change Calendar", href: "/changes/calendar", icon: CalendarRange },
      { title: "Releases", href: "/releases", icon: Rocket },
    ],
  },
  {
    label: "Operations",
    items: [
      { title: "Status", href: "/status", icon: Activity },
      { title: "On-call", href: "/oncall", icon: PhoneCall },
    ],
  },
  {
    label: "Services",
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
      { title: "Contracts", href: "/contracts", icon: FileSignature },
    ],
  },
  {
    label: "Organisation",
    items: [
      { title: "People", href: "/people", icon: Boxes },
      { title: "Groups", href: "/groups", icon: Users },
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

/**
 * The nav href to highlight for `pathname`: the longest href that equals the
 * path or is a whole-segment prefix of it ("/" only on an exact match). Longest
 * wins, so nested entries never light up together: /changes/calendar selects
 * "Change Calendar" while /changes/42 still selects "Changes".
 */
export function activeNavHref(hrefs: readonly string[], pathname: string): string | undefined {
  let best: string | undefined;
  for (const href of hrefs) {
    const matches =
      href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
    if (matches && (best === undefined || href.length > best.length)) best = href;
  }
  return best;
}

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
