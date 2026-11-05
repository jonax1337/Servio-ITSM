import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A Button with an AI look — a subtle monochrome Nova Flow tint (the `--sable`
 * tokens) so AI affordances read as distinct from ordinary actions. Accepts
 * all Button props.
 */
function AiButton({ className, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn(
        "sable-accent-border border-sable/25 bg-sable-muted/50 text-foreground hover:bg-sable-muted hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { AiButton };
