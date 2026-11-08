"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search, Loader2, CornerDownLeft, BookOpen, ShoppingBag, Ticket, ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

type Result = { group: string; href: string; title: string; sub: string };

const GROUP_ICON: Record<string, typeof Search> = {
  Answers: BookOpen,
  Services: ShoppingBag,
  "Your requests": Ticket,
};

export function PortalSearch({
  className,
  placeholder,
  autoFocus = false,
}: {
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const t = useT("portal");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const reqId = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // Debounced, race-safe server search against the portal-scoped endpoint.
  // All state updates happen inside the timeout callback (not synchronously in
  // the effect body) so we don't trigger cascading renders.
  useEffect(() => {
    const q = query.trim();
    const id = ++reqId.current;
    const timer = setTimeout(
      async () => {
        if (!q) {
          if (id === reqId.current) {
            setResults([]);
            setLoading(false);
          }
          return;
        }
        if (id === reqId.current) setLoading(true);
        try {
          const res = await fetch(`/api/portal/search?q=${encodeURIComponent(q)}`);
          const data = await res.json();
          if (id === reqId.current) {
            setResults(data.results ?? []);
            setActive(0);
          }
        } catch {
          if (id === reqId.current) setResults([]);
        } finally {
          if (id === reqId.current) setLoading(false);
        }
      },
      q ? 200 : 0,
    );
    return () => clearTimeout(timer);
  }, [query]);

  // Dismiss on outside click.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const q = query.trim();
  const searchAll = () => {
    setOpen(false);
    router.push(`/portal/knowledge?q=${encodeURIComponent(q)}`);
  };
  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[active]) go(results[active].href);
      else if (q) searchAll();
    }
  };

  const grouped = results.reduce<Record<string, Result[]>>((acc, r) => {
    (acc[r.group] ??= []).push(r);
    return acc;
  }, {});
  // A flat index shared with keyboard nav so arrow keys traverse across groups.
  let flat = -1;

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <div
        className={cn(
          "flex items-center gap-3 rounded-2xl border bg-card px-4 shadow-sm transition-shadow",
          "focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/10",
        )}
      >
        {loading ? (
          <Loader2 className="size-5 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <Search className="size-5 shrink-0 text-muted-foreground" />
        )}
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoFocus={autoFocus}
          value={query}
          placeholder={placeholder ?? t("searchPlaceholder")}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="h-14 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
        />
        <kbd className="pointer-events-none hidden select-none items-center gap-1 rounded-md border bg-muted/60 px-1.5 py-1 font-mono text-[10px] font-medium text-muted-foreground sm:flex">
          <CornerDownLeft className="size-3" /> {t("toSearch")}
        </kbd>
      </div>

      {open && q ? (
        <div
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50 overflow-hidden rounded-2xl border bg-popover shadow-xl animate-in fade-in-0 zoom-in-95 slide-in-from-top-1"
        >
          <div className="max-h-[22rem] overflow-y-auto p-2">
            {loading && results.length === 0 ? (
              <div className="flex items-center gap-2 px-3 py-8 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> {t("searching")}
              </div>
            ) : results.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                {t.rich("noMatchesFor", {
                  query: q,
                  q: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
                })}
                <br />
                {t("tryDifferentWords")}
              </div>
            ) : (
              Object.entries(grouped).map(([group, items]) => {
                const Icon = GROUP_ICON[group] ?? Search;
                return (
                  <div key={group} className="mb-1 last:mb-0">
                    <p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t.dyn(`searchGroup.${group}`, undefined, group)}
                    </p>
                    {items.map((r) => {
                      flat += 1;
                      const idx = flat;
                      return (
                        <button
                          key={r.href}
                          type="button"
                          role="option"
                          aria-selected={active === idx}
                          onMouseEnter={() => setActive(idx)}
                          onClick={() => go(r.href)}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                            active === idx ? "bg-accent" : "hover:bg-muted/60",
                          )}
                        >
                          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                            <Icon className="size-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{r.title}</span>
                            <span className="block truncate text-xs text-muted-foreground">{r.sub}</span>
                          </span>
                          <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                        </button>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
          <button
            type="button"
            onClick={searchAll}
            className="flex w-full items-center gap-2 border-t bg-muted/30 px-4 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-muted/60"
          >
            <Search className="size-4" />
            {t("searchKbFor", { query: q })}
          </button>
        </div>
      ) : null}
    </div>
  );
}
