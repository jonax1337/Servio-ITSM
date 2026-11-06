"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Check, CheckCheck, Loader2 } from "lucide-react";
import type { Notification } from "@prisma/client";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  listNotifications,
  markAllRead,
  markRead,
} from "@/lib/actions/notifications";

const ENTITY_HREF: Record<string, string> = {
  Ticket: "/tickets",
  Problem: "/problems",
  Change: "/changes",
  Contract: "/contracts",
  SoftwareLicense: "/contracts/licenses",
  OnCallSchedule: "/oncall",
};

function hrefFor(entity?: string | null, entityId?: string | null) {
  if (!entity || !entityId) return null;
  const base = ENTITY_HREF[entity];
  return base ? `${base}/${entityId}` : null;
}

export function NotificationsMenu({
  unreadCount: initialUnread,
}: {
  unreadCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[] | null>(null);
  const [unread, setUnread] = useState(initialUnread);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();

  // Keep the badge in sync with the server-rendered seed on navigation.
  useEffect(() => {
    // intentional: re-seed the badge from the server-rendered prop on navigation
    // (unread is also mutated locally, so it cannot be derived during render).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUnread(initialUnread);
  }, [initialUnread]);

  // Load the list when the popover opens.
  useEffect(() => {
    if (!open) return;
    let active = true;
    // intentional: enter the loading state before fetching the list on open.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    listNotifications().then((res) => {
      if (!active) return;
      setItems(res.notifications);
      setUnread(res.unreadCount);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [open]);

  const syncFromServer = () => {
    listNotifications().then((res) => {
      setItems(res.notifications);
      setUnread(res.unreadCount);
    });
    router.refresh();
  };

  const onMarkRead = (id: string) => {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      await markRead(fd);
      setItems((prev) =>
        prev?.map((n) => (n.id === id ? { ...n, read: true } : n)) ?? prev,
      );
      setUnread((u) => Math.max(0, u - 1));
      syncFromServer();
    });
  };

  const onMarkAll = () => {
    startTransition(async () => {
      await markAllRead();
      setItems((prev) => prev?.map((n) => ({ ...n, read: true })) ?? prev);
      setUnread(0);
      syncFromServer();
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label="Notifications"
          />
        }
      >
        <Bell className="size-4" />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-none text-primary-foreground ring-2 ring-background">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 gap-0 overflow-hidden p-0"
      >
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
          <PopoverHeader>
            <PopoverTitle>Notifications</PopoverTitle>
          </PopoverHeader>
          <Button
            variant="ghost"
            size="xs"
            onClick={onMarkAll}
            disabled={pending || unread === 0}
          >
            <CheckCheck className="size-3.5" /> Mark all read
          </Button>
        </div>

        <div className="max-h-[22rem] overflow-y-auto">
          {loading && items === null ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : !items || items.length === 0 ? (
            <div className="px-3 py-10 text-center text-sm text-muted-foreground">
              You&apos;re all caught up.
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((n) => {
                const href = hrefFor(n.entity, n.entityId);
                const title = (
                  <span
                    className={cn(
                      "text-sm font-medium",
                      !n.read && "text-foreground",
                    )}
                  >
                    {n.title}
                  </span>
                );
                return (
                  <li
                    key={n.id}
                    className={cn(
                      "flex items-start gap-2.5 px-3 py-2.5",
                      !n.read && "bg-primary/5",
                    )}
                  >
                    <span className="mt-1.5 flex size-2 shrink-0">
                      {!n.read ? (
                        <span className="size-2 rounded-full bg-primary" />
                      ) : null}
                    </span>

                    <div className="min-w-0 flex-1">
                      {href ? (
                        <Link
                          href={href}
                          className="hover:text-primary"
                          onClick={() => setOpen(false)}
                        >
                          {title}
                        </Link>
                      ) : (
                        title
                      )}
                      {n.body ? (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {n.body}
                        </p>
                      ) : null}
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {formatDistanceToNow(n.createdAt, { addSuffix: true })}
                      </p>
                    </div>

                    {!n.read ? (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="shrink-0"
                        aria-label="Mark as read"
                        onClick={() => onMarkRead(n.id)}
                        disabled={pending}
                      >
                        <Check className="size-3.5" />
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
