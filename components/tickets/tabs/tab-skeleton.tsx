import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder shown while the active tab's data loads. */
export function TabSkeleton() {
  return (
    <div className="grid gap-3" aria-hidden>
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-16 w-4/5 rounded-xl" />
    </div>
  );
}
