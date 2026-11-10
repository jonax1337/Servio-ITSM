"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { ThemeToggle } from "@/components/theme-toggle";
import { CommandMenu } from "@/components/command-menu";
import { CreateMenu } from "@/components/create-menu";
import { NotificationsMenu } from "@/components/notifications-menu";
import { UserMenu } from "@/components/user-menu";
import { AI_ASSISTANT_NAME, changeRef, problemRef, releaseRef } from "@/lib/constants";
import { requiredRoleFor, roleAtLeast } from "@/lib/route-guard";
import { useT } from "@/lib/i18n/client";
import type { Translator } from "@/lib/i18n/translate";


/** Ancestor paths without a page of their own: the crumb opens the tab the detail page's back button opens. */
const CRUMB_HREF: Record<string, string> = {
  "/contracts/licenses": "/contracts?tab=licenses",
  "/contracts/vendors": "/contracts?tab=vendors",
};

/** Detail segments whose numeric id has a ref style; other numeric ids read "#id". */
const REF_BY_PARENT: Record<string, (id: number) => string> = {
  problems: problemRef,
  changes: changeRef,
  releases: releaseRef,
};

type Labels = { nav: Translator<"nav">; shell: Translator<"shell"> };

/** A crumb: the nav title for the path, a known segment, a ref/id, or the humanized segment. */
function label(seg: string, path: string, parent: string | undefined, t: Labels) {
  if (seg === "assistant") return AI_ASSISTANT_NAME;
  if (t.nav.has(path)) return t.nav.dyn(path);
  if (/^\d+$/.test(seg)) return (parent && REF_BY_PARENT[parent]?.(Number(seg))) || `#${seg}`;
  // cuid-like ids (e.g. cmskaeker0022v6l8mv61vvni) → friendly label
  if (/^[a-z0-9]{18,}$/i.test(seg) && /\d/.test(seg)) return t.shell("crumb.details");
  const humanized = seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return t.shell.dyn(`crumb.${seg}`, undefined, humanized);
}

export function AppTopbar({
  user,
  notifications,
  sableEnabled = false,
}: {
  user: { name: string; email: string; role: string; image?: string | null };
  notifications: number;
  sableEnabled?: boolean;
}) {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const labels: Labels = { nav: useT("nav"), shell: useT("shell") };

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <SidebarTrigger className="-ml-1" />
      <Breadcrumb className="ml-1 hidden min-w-0 overflow-hidden md:block">
        <BreadcrumbList className="flex-nowrap whitespace-nowrap [&>li:last-child]:min-w-0 [&>li:last-child]:truncate">
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/" />}>Servio</BreadcrumbLink>
          </BreadcrumbItem>
          {segments.map((seg, i) => {
            const path = "/" + segments.slice(0, i + 1).join("/");
            const href = CRUMB_HREF[path] ?? path;
            const last = i === segments.length - 1;
            const canOpen = roleAtLeast(user.role, requiredRoleFor(path));
            return (
              <Fragment key={path}>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  {last ? (
                    <BreadcrumbPage>{label(seg, path, segments[i - 1], labels)}</BreadcrumbPage>
                  ) : canOpen ? (
                    <BreadcrumbLink render={<Link href={href} />}>
                      {label(seg, path, segments[i - 1], labels)}
                    </BreadcrumbLink>
                  ) : (
                    <span>{label(seg, path, segments[i - 1], labels)}</span>
                  )}
                </BreadcrumbItem>
              </Fragment>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <CommandMenu role={user.role} sableEnabled={sableEnabled} />
        <CreateMenu />
        <NotificationsMenu unreadCount={notifications} />
        <ThemeToggle />
        <UserMenu {...user} />
      </div>
    </header>
  );
}
