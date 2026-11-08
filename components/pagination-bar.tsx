import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buildHref, type SearchParams } from "@/lib/query";
import { cn } from "@/lib/utils";
import { Msg } from "@/lib/i18n/client";

export function PaginationBar({
  pathname,
  searchParams,
  page,
  pageSize,
  total,
}: {
  pathname: string;
  searchParams: SearchParams;
  page: number;
  pageSize: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const link = (p: number, disabled: boolean, children: React.ReactNode) => (
    <Link
      href={buildHref(pathname, searchParams, { page: p === 1 ? undefined : p })}
      aria-disabled={disabled}
      className={cn(
        "inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm transition-colors hover:bg-accent",
        disabled && "pointer-events-none opacity-40",
      )}
    >
      {children}
    </Link>
  );

  return (
    <div className="flex items-center justify-between px-1 py-3 text-sm text-muted-foreground">
      <span className="tabular-nums">
        <Msg ns="components" k="pagination.range" vars={{ from, to, total }} />
      </span>
      <div className="flex items-center gap-1.5">
        {link(page - 1, page <= 1, <><ChevronLeft className="size-4" /> <Msg ns="components" k="pagination.prev" /></>)}
        <span className="px-2 tabular-nums">
          {page} / {pages}
        </span>
        {link(page + 1, page >= pages, <><Msg ns="components" k="pagination.next" /> <ChevronRight className="size-4" /></>)}
      </div>
    </div>
  );
}
