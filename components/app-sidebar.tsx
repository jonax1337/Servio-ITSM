"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
} from "@/components/ui/sidebar";
import { Logo, BrandName } from "@/components/brand";
import { activeNavHref, consoleNav, filterNav, navGroupKey, navItemKey } from "@/lib/nav";
import { useT } from "@/lib/i18n/client";
import { APP_VERSION } from "@/lib/constants";

export function AppSidebar({ role }: { role: string }) {
  const pathname = usePathname();
  const t = useT("nav");
  const ts = useT("shell");
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

      <SidebarContent className="gap-0.5 py-1">
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{t.dyn(navGroupKey(group), undefined, group.label)}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                {group.items.map((item) => {
                  const title = t.dyn(navItemKey(item), undefined, item.title);
                  return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      render={<Link href={item.href} />}
                      isActive={item.href === activeHref}
                      tooltip={title}
                      className="h-9"
                    >
                      <item.icon className="size-4" />
                      <span>{title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t group-data-[collapsible=icon]:hidden">
        <p className="px-2 py-1 text-[11px] text-muted-foreground">
          {ts("footer", { version: APP_VERSION })}
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
