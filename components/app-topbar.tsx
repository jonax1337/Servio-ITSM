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
import { AI_ASSISTANT_NAME } from "@/lib/constants";

function label(seg: string) {
  if (seg === "assistant") return AI_ASSISTANT_NAME;
  if (/^\d+$/.test(seg)) return `#${seg}`;
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
        <BreadcrumbList>
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
                    <BreadcrumbPage>{label(seg)}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink render={<Link href={href} />}>
                      {label(seg)}
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
