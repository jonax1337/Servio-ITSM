import { Skeleton } from "@/components/ui/skeleton";

// Mirrors the ticket detail page: a scrolling main column (header bar, title,
// description card, tab bar, composer) beside a 340px properties rail.
export default function TicketDetailLoading() {
  return (
    <div className="grid gap-0 lg:h-[calc(100svh-3.5rem)] lg:grid-cols-[1fr_340px] lg:overflow-hidden">
      <div className="min-w-0 border-b lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        {/* Detail header bar */}
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-6">
          <Skeleton className="size-7 rounded-md" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-14 rounded-full" />
          <Skeleton className="ml-auto h-8 w-40 rounded-lg" />
        </div>

        <div className="p-4 sm:p-6">
          <Skeleton className="h-7 w-2/3 max-w-md" />
          <Skeleton className="mt-2 h-4 w-52" />

          <div className="mt-4 rounded-xl border bg-card p-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="mt-2 h-4 w-11/12" />
            <Skeleton className="mt-2 h-4 w-4/5" />
          </div>

          {/* Tab bar */}
          <div className="mt-6 flex gap-2 border-b pb-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-5 w-20 rounded-md" />
            ))}
          </div>

          {/* Composer */}
          <div className="mt-5 grid gap-2 rounded-xl border bg-card p-3">
            <Skeleton className="h-20 w-full rounded-lg" />
            <div className="flex items-center justify-between border-t pt-2">
              <Skeleton className="h-8 w-28 rounded-md" />
              <Skeleton className="h-8 w-16 rounded-md" />
            </div>
          </div>
        </div>
      </div>

      {/* Properties rail */}
      <aside className="p-4 sm:p-6 lg:min-h-0 lg:overflow-y-auto">
        {[0, 1, 2].map((i) => (
          <div key={i} className={i === 0 ? "" : "mt-4"}>
            <div className="rounded-xl border bg-card">
              <div className="border-b px-4 py-3">
                <Skeleton className="h-4 w-24" />
              </div>
              <div className="grid gap-2.5 p-4">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-5/6" />
              </div>
            </div>
          </div>
        ))}
      </aside>
    </div>
  );
}
