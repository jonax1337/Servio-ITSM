"use client";

import { useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Logo, BrandName } from "@/components/brand";
import { activeNavHref, consoleNav, filterNav, navGroupKey, navItemKey } from "@/lib/nav";
import { useT } from "@/lib/i18n/client";
import { APP_VERSION } from "@/lib/constants";

/** localStorage key holding the labels of the nav groups the user folded away. */
const COLLAPSED_GROUPS_KEY = "servio:nav-collapsed-groups";

const NONE_COLLAPSED = "[]";
const storeListeners = new Set<() => void>();
// Fallback when storage is blocked, so a fold still applies for this page view.
let memoryValue = NONE_COLLAPSED;

function readCollapsed(): string {
  try {
    return localStorage.getItem(COLLAPSED_GROUPS_KEY) ?? NONE_COLLAPSED;
  } catch {
    return memoryValue;
  }
}

function writeCollapsed(value: string) {
  memoryValue = value;
  try {
    localStorage.setItem(COLLAPSED_GROUPS_KEY, value);
  } catch {
    // Private mode or quota: memoryValue keeps it for this page view.
  }
  storeListeners.forEach((notify) => notify());
}

function subscribeCollapsed(notify: () => void) {
  storeListeners.add(notify);
  window.addEventListener("storage", notify);
  return () => {
    storeListeners.delete(notify);
    window.removeEventListener("storage", notify);
  };
}

function parseLabels(raw: string): ReadonlySet<string> {
  try {
    const stored = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(stored) ? stored.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

/**
 * The folded nav groups, remembered per browser. The server render (and hydration) sees every
 * group open; a missing, blocked or corrupt storage also just means "all open".
 */
function useCollapsedGroups() {
  const raw = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => NONE_COLLAPSED);
  const collapsed = useMemo(() => parseLabels(raw), [raw]);

  function setGroupOpen(label: string, open: boolean) {
    const next = new Set(collapsed);
    if (open) next.delete(label);
    else next.add(label);
    writeCollapsed(JSON.stringify([...next]));
  }

  return { collapsed, setGroupOpen };
}

export function AppSidebar({ role }: { role: string }) {
  const pathname = usePathname();
  const t = useT("nav");
  const ts = useT("shell");
  const { state } = useSidebar();
  const { collapsed, setGroupOpen } = useCollapsedGroups();
  const groups = filterNav(consoleNav, role);

  const activeHref = activeNavHref(
    groups.flatMap((g) => g.items.map((i) => i.href)),
    pathname,
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-14 justify-center border-b group-data-[collapsible=icon]:items-center">
        <Link href="/" aria-label={ts("home")} className="flex items-center gap-2.5 px-1">
          <Logo />
          <div className="grid leading-none group-data-[collapsible=icon]:hidden">
            <BrandName brand="servio" className="h-4.5" />
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="gap-0 py-1">
        {groups.map((group) => {
          const label = t.dyn(navGroupKey(group), undefined, group.label);
          const holdsActive = group.items.some((i) => i.href === activeHref);
          // The icon rail has no group labels to unfold, and the current page's group never hides.
          const iconRail = state === "collapsed";
          const open = iconRail || holdsActive || !collapsed.has(group.label);
          return (
            <Collapsible
              key={group.label}
              open={open}
              onOpenChange={(next) => setGroupOpen(group.label, next)}
            >
              <SidebarGroup className="py-1">
                <SidebarGroupLabel
                  render={<CollapsibleTrigger disabled={holdsActive || iconRail} tabIndex={iconRail ? -1 : undefined} />}
                  className="group/label w-full cursor-pointer justify-between text-[11px] tracking-wide uppercase hover:text-sidebar-foreground disabled:cursor-default disabled:hover:text-sidebar-foreground/70"
                >
                  {label}
                  <ChevronRight
                    aria-hidden
                    className="size-3.5 transition-transform group-data-[panel-open]/label:rotate-90"
                  />
                </SidebarGroupLabel>
                <CollapsibleContent>
                  <SidebarGroupContent>
                    <SidebarMenu className="gap-0.5">
                      {group.items.map((item) => {
                        const title = t.dyn(navItemKey(item), undefined, item.title);
                        return (
                          <SidebarMenuItem key={item.href}>
                            <SidebarMenuButton
                              render={<Link href={item.href} />}
                              isActive={item.href === activeHref}
                              tooltip={title}
                              className="h-8"
                            >
                              <item.icon className="size-4" />
                              <span>{title}</span>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </SidebarGroup>
            </Collapsible>
          );
        })}
      </SidebarContent>

      <SidebarFooter className="border-t group-data-[collapsible=icon]:hidden">
        <p className="px-2 py-1 text-[11px] text-muted-foreground">
          {ts("footer", { version: APP_VERSION })}
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
