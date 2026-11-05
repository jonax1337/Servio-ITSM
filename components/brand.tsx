import { cn } from "@/lib/utils";
import { brandAssets } from "@/lib/brand-assets";

export function Logo({ className }: { className?: string }) {
  const mark = brandAssets.marks.servio;
  return (
    <svg
      viewBox={`-1 -1 ${mark.width + 2} ${mark.height + 2}`}
      fill="currentColor"
      className={cn("size-8 shrink-0 text-brand-cobalt dark:text-white", className)}
      aria-hidden="true"
    >
      {mark.paths.map((path, index) => (
        <path key={index} d={path.d} transform={path.transform} />
      ))}
    </svg>
  );
}

export function BrandName({ brand, className }: { brand: "servio" | "sable"; className?: string }) {
  const word = brandAssets.wordmarks[brand];
  const [, , width, height] = word.viewBox.split(" ").map(Number);
  return (
    <svg
      viewBox={word.viewBox}
      width={width}
      height={height}
      fill="currentColor"
      role="img"
      aria-label={brand === "servio" ? "Servio" : "Sable"}
      className={cn("h-5 w-auto shrink-0", className)}
    >
      <path d={word.path} />
    </svg>
  );
}

export function Wordmark({
  className,
  subtitle,
}: {
  className?: string;
  subtitle?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <Logo />
      <div className="grid leading-none">
        <BrandName brand="servio" />
        {subtitle ? (
          <span className="text-[11px] font-medium text-muted-foreground">
            {subtitle}
          </span>
        ) : null}
      </div>
    </div>
  );
}
