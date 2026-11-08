"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ShoppingBag, AlertCircle, Ticket, BookOpen, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

const items = [
  { href: "/portal", label: "nav.home", icon: Home },
  { href: "/portal/catalog", label: "nav.catalog", icon: ShoppingBag },
  { href: "/portal/new", label: "nav.reportIssue", icon: AlertCircle },
  { href: "/portal/tickets", label: "nav.myTickets", icon: Ticket },
  { href: "/portal/knowledge", label: "nav.knowledge", icon: BookOpen },
  { href: "/portal/status", label: "nav.status", icon: Activity },
] as const;

export function PortalNav() {
  const pathname = usePathname();
  const t = useT("portal");
  const active = (href: string) =>
    href === "/portal" ? pathname === "/portal" : pathname.startsWith(href);

  return (
    <nav className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {items.map((i) => {
        const on = active(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={on ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              on
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <i.icon className="size-4" />
            {t(i.label)}
          </Link>
        );
      })}
    </nav>
  );
}
