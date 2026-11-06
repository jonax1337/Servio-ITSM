"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ShoppingBag, AlertCircle, Ticket, BookOpen, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/portal", label: "Home", icon: Home },
  { href: "/portal/catalog", label: "Catalog", icon: ShoppingBag },
  { href: "/portal/new", label: "Report an issue", icon: AlertCircle },
  { href: "/portal/tickets", label: "My tickets", icon: Ticket },
  { href: "/portal/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/portal/status", label: "Status", icon: Activity },
];

export function PortalNav() {
  const pathname = usePathname();
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
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
