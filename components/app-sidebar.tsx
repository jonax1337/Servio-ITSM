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
import { consoleNav, filterNav } from "@/lib/nav";
import { APP_VERSION } from "@/lib/constants";

export function AppSidebar({ role }: { role: string }) {
  const pathname = usePathname();
  const groups = filterNav(consoleNav, role);

  // Items that other nav entries nest under (e.g. "/settings" with
  // "/settings/macros") only light up on an exact match, so two items never
  // highlight at once. Everything else stays prefix-matched.
  const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  const sectionRoots = new Set(
    hrefs.filter((h) => hrefs.some((o) => o.startsWith(`${h}/`))),
  );

  const isActive = (href: string) =>
    sectionRoots.has(href) || href === "/"
      ? pathname === href
      : pathname.startsWith(href);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-14 justify-center border-b group-data-[collapsible=icon]:items-center">
        <Link href="/" aria-label="Servio home" className="flex items-center gap-2.5 px-1">
          <Logo />
          <div className="grid leading-none group-data-[collapsible=icon]:hidden">
            <BrandName brand="servio" className="h-4.5" />
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="gap-0.5 py-1">
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      render={<Link href={item.href} />}
                      isActive={isActive(item.href)}
                      tooltip={item.title}
                      className="h-9"
                    >
                      <item.icon className="size-4" />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t group-data-[collapsible=icon]:hidden">
        <p className="px-2 py-1 text-[11px] text-muted-foreground">
          Servio v{APP_VERSION} · MIT licensed
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
