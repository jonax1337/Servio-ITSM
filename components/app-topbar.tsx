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

const SEGMENT_LABELS: Record<string, string> = {
  assistant: AI_ASSISTANT_NAME,
  oncall: "On-call",
  freeze: "Freeze windows",
};

/** Detail segments whose numeric id has a ref style; other numeric ids read "#id". */
const REF_BY_PARENT: Record<string, (id: number) => string> = {
  problems: problemRef,
  changes: changeRef,
  releases: releaseRef,
};

function label(seg: string, parent?: string) {
  if (SEGMENT_LABELS[seg]) return SEGMENT_LABELS[seg];
  if (/^\d+$/.test(seg)) return (parent && REF_BY_PARENT[parent]?.(Number(seg))) || `#${seg}`;
  // cuid-like ids (e.g. cmskaeker0022v6l8mv61vvni) → friendly label
  if (/^[a-z0-9]{18,}$/i.test(seg) && /\d/.test(seg)) return "Details";
  return seg
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
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

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <SidebarTrigger className="-ml-1" />
      <Breadcrumb className="ml-1 hidden md:block">
        <BreadcrumbList className="flex-nowrap whitespace-nowrap">
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/" />}>Servio</BreadcrumbLink>
          </BreadcrumbItem>
          {segments.map((seg, i) => {
            const href = "/" + segments.slice(0, i + 1).join("/");
            const last = i === segments.length - 1;
            return (
              <Fragment key={href}>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  {last ? (
                    <BreadcrumbPage>{label(seg, segments[i - 1])}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink render={<Link href={href} />}>
                      {label(seg, segments[i - 1])}
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </Fragment>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex items-center gap-1.5">
        <CommandMenu role={user.role} sableEnabled={sableEnabled} />
        <CreateMenu />
        <NotificationsMenu unreadCount={notifications} />
        <ThemeToggle />
        <UserMenu {...user} />
      </div>
    </header>
  );
}
