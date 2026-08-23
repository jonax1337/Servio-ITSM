import { Skeleton } from "@/components/ui/skeleton";

// Mirrors the portal home rhythm: hero, then a wide request list beside a
// narrow article list, then the service-card grid.
export default function PortalLoading() {
  return (
    <div className="grid gap-10">
      <div className="grid gap-3 text-center">
        <Skeleton className="mx-auto h-9 w-80 max-w-full" />
        <Skeleton className="mx-auto h-4 w-96 max-w-full" />
      </div>

      <div className="grid gap-10 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <Skeleton className="mb-4 h-5 w-44" />
          <div className="divide-y overflow-hidden rounded-2xl border bg-card">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                <Skeleton className="h-4 w-14 shrink-0" />
                <Skeleton className="h-4 min-w-0 flex-1" style={{ width: `${58 - i * 12}%` }} />
                <Skeleton className="hidden h-5 w-20 shrink-0 rounded-full sm:block" />
              </div>
            ))}
          </div>
        </section>

        <section>
          <Skeleton className="mb-4 h-5 w-36" />
          <div className="divide-y overflow-hidden rounded-2xl border bg-card">
            {[0, 1, 2].map((i) => (
              <div key={i} className="px-4 py-3">
                <Skeleton className="h-4" style={{ width: `${78 - i * 14}%` }} />
              </div>
            ))}
          </div>
        </section>
      </div>

      <section>
        <Skeleton className="mb-4 h-5 w-40" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="rounded-2xl border bg-card p-4">
              <div className="flex items-start gap-3">
                <Skeleton className="size-10 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="mt-2 h-3.5 w-full" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
