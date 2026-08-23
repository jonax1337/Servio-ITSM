import { Skeleton } from "@/components/ui/skeleton";

// Row-width variety is fixed (no randomness) so server and client renders agree.
const ROW_WIDTHS = ["72%", "58%", "81%", "46%", "66%", "77%", "52%", "69%"];

export default function ConsoleLoading() {
  return (
    <div>
      {/* PageHeader-like block */}
      <div className="flex flex-col gap-4 border-b px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="grid gap-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="hidden h-9 w-28 rounded-lg sm:block" />
      </div>

      <div className="p-4 sm:p-6">
        {/* List toolbar */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Skeleton className="h-9 min-w-48 flex-1 rounded-lg" />
          <Skeleton className="h-9 w-36 rounded-lg" />
          <Skeleton className="h-9 w-36 rounded-lg" />
          <Skeleton className="ml-auto h-9 w-24 rounded-lg" />
        </div>

        {/* Table rows */}
        <div className="overflow-hidden rounded-xl border">
          {ROW_WIDTHS.map((w, i) => (
            <div
              key={i}
              className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0"
            >
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <Skeleton className="h-4" style={{ width: w }} />
              <Skeleton className="ml-auto hidden h-4 w-20 sm:block" />
              <Skeleton className="hidden h-5 w-24 rounded-full md:block" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
