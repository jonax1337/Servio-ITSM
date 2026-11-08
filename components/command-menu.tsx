"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Ticket, AlertTriangle, GitPullRequestArrow, Server, User, LifeBuoy, Loader2, MessageSquarePlus } from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { SableMark } from "@/components/sable-mark";
import { AI_ASSISTANT_NAME } from "@/lib/constants";
import { useSable } from "@/components/assistant/sable-provider";
import { consoleNav, filterNav, navGroupKey, navItemKey } from "@/lib/nav";
import { useT } from "@/lib/i18n/client";
import { isTextEntryTarget } from "@/lib/utils";

type Result = { group: string; href: string; title: string; sub: string };

const GROUP_ICON: Record<string, typeof Ticket> = {
  Tickets: Ticket, Problems: AlertTriangle, Changes: GitPullRequestArrow,
  Assets: Server, People: User, Services: LifeBuoy,
};

export function CommandMenu({ role, sableEnabled = false }: { role: string; sableEnabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const sable = useSable();
  const groups = filterNav(consoleNav, role);
  const t = useT("shell");
  const tn = useT("nav");
  const reqId = useRef(0);

  // Open Sable (docking it if closed), optionally starting a fresh chat and
  // pre-filling the composer with `text`. The composer mounts a tick after the
  // window opens, so retry the insert until the live textarea exists.
  const askSable = (opts: { fresh?: boolean; text?: string }) => {
    setOpen(false);
    setQuery("");
    if (sable.state === "closed") sable.open("min");
    if (opts.fresh) sable.newChat();
    const text = opts.text?.trim();
    if (!text) return;
    let tries = 0;
    const tick = () => {
      const el = document.querySelector('textarea[data-sable-composer]');
      if (el) sable.insertIntoComposer(text);
      else if (tries++ < 25) setTimeout(tick, 60);
    };
    setTimeout(tick, 60);
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || e.key === "/") {
        if (e.key === "/" && isTextEntryTarget(e.target)) return;
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  // debounced server search
  useEffect(() => {
    const q = query.trim();
    // intentional: clear results / enter loading state before the debounced fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!q) { setResults([]); setLoading(false); return; }
    setLoading(true);
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (id === reqId.current) setResults(data.results ?? []);
      } catch {
        if (id === reqId.current) setResults([]);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [query]);

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  const grouped = results.reduce<Record<string, Result[]>>((acc, r) => {
    (acc[r.group] ??= []).push(r);
    return acc;
  }, {});

  return (
    <>
      <button
        type="button"
        aria-label={t("search")}
        onClick={() => setOpen(true)}
        className="flex size-9 shrink-0 items-center justify-center gap-2 rounded-lg border bg-muted/40 text-sm text-muted-foreground transition-colors hover:bg-muted sm:w-64 sm:justify-start sm:px-3"
      >
        <Search className="size-4" />
        <span className="hidden flex-1 text-left sm:block">{t("searchPlaceholder")}</span>
        <kbd className="pointer-events-none hidden select-none items-center gap-0.5 rounded border bg-background px-1.5 font-mono text-[10px] font-medium sm:flex">
          ⌘K
        </kbd>
      </button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={t("searchInputPlaceholder")}
          />
          <CommandList>
            {query.trim() ? (
              <>
                {sableEnabled ? (
                  <CommandGroup heading={AI_ASSISTANT_NAME}>
                    <CommandItem value="ask-sable" onSelect={() => askSable({ fresh: true, text: query })}>
                      <SableMark className="size-4 text-sable" />
                      <span className="flex-1 truncate">
                        {t("askSable", { name: AI_ASSISTANT_NAME })} <span className="text-muted-foreground">“{query.trim()}”</span>
                      </span>
                    </CommandItem>
                  </CommandGroup>
                ) : null}
                {loading ? (
                  <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> {t("searching")}
                  </div>
                ) : results.length === 0 ? (
                  <CommandEmpty>{t("noResultsFor", { query })}</CommandEmpty>
                ) : (
                  Object.entries(grouped).map(([group, items]) => {
                    const Icon = GROUP_ICON[group] ?? Search;
                    return (
                      <CommandGroup key={group} heading={t.dyn(`searchGroup.${group}`, undefined, group)}>
                        {items.map((r) => (
                          <CommandItem key={r.href} value={r.href} onSelect={() => go(r.href)}>
                            <Icon className="size-4 text-muted-foreground" />
                            <span className="flex-1 truncate">{r.title}</span>
                            <span className="font-mono text-xs text-muted-foreground">{r.sub}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    );
                  })
                )}
              </>
            ) : (
              <>
                {sableEnabled ? (
                  <CommandGroup heading={AI_ASSISTANT_NAME}>
                    <CommandItem value="open-sable" onSelect={() => askSable({})}>
                      <SableMark className="size-4 text-sable" /> {t("openSable", { name: AI_ASSISTANT_NAME })}
                    </CommandItem>
                    <CommandItem value="new-sable-chat" onSelect={() => askSable({ fresh: true })}>
                      <MessageSquarePlus className="size-4" /> {t("newSableChat", { name: AI_ASSISTANT_NAME })}
                    </CommandItem>
                  </CommandGroup>
                ) : null}
                <CommandGroup heading={t("quickActions")}>
                  <CommandItem value="new-ticket" onSelect={() => go("/tickets/new")}>
                    <Ticket className="size-4" /> {t("createTicket")}
                  </CommandItem>
                  <CommandItem value="new-change" onSelect={() => go("/changes/new")}>
                    <GitPullRequestArrow className="size-4" /> {t("newChangeRequest")}
                  </CommandItem>
                  <CommandItem value="new-asset" onSelect={() => go("/assets/new")}>
                    <Server className="size-4" /> {t("addAsset")}
                  </CommandItem>
                </CommandGroup>
                {groups.map((g) => (
                  <CommandGroup key={g.label} heading={tn.dyn(navGroupKey(g), undefined, g.label)}>
                    {g.items.map((i) => (
                      <CommandItem key={i.href} value={i.href} onSelect={() => go(i.href)}>
                        <i.icon className="size-4" />
                        {tn.dyn(navItemKey(i), undefined, i.title)}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
              </>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
