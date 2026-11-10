import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  children,
  className,
  icon: Icon,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 border-b px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <div className="mt-0.5 grid size-9 place-items-center rounded-lg border bg-card text-primary">
            <Icon className="size-4.5" />
          </div>
        ) : null}
        <div className="grid gap-1">
          <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
            {title}
          </h1>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {children ? (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:flex-nowrap">{children}</div>
      ) : null}
    </div>
  );
}

export function PageBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("p-4 sm:p-6", className)}>{children}</div>;
}
