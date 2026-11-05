import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { brandAssets } from "@/lib/brand-assets";

type SableMarkProps = ComponentPropsWithoutRef<"svg"> & {
  size?: number | string;
  accent?: boolean;
};

export const SableMark = forwardRef<SVGSVGElement, SableMarkProps>(function SableMark(
  { size = 24, accent = false, color = "currentColor", ...props },
  ref,
) {
  const mark = brandAssets.marks.sable;
  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      color={color}
      fill="currentColor"
      aria-hidden={props["aria-label"] ? undefined : true}
      role={props["aria-label"] ? "img" : undefined}
      {...props}
      viewBox={`-1 -1 ${mark.width + 2} ${mark.height + 2}`}
      stroke="none"
    >
      {mark.paths.map((path, index) => (
        <path
          key={index}
          d={path.d}
          transform={path.transform}
          fill={accent ? (index < 3 ? brandAssets.colors.cobalt : brandAssets.colors.ice) : undefined}
        />
      ))}
    </svg>
  );
});
