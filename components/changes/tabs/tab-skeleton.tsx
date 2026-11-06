import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder while a tab panel loads its own data. */
export function TabSkeleton() {
  return (
    <div className="grid gap-3" aria-hidden>
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  );
}
