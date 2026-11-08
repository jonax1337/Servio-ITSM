"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { useT } from "@/lib/i18n/client";

export default function ConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT("errors");
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="p-4 sm:p-6">
      <EmptyState
        icon={AlertTriangle}
        title={t("errorTitle")}
        description={error.digest ? t("errorWithRef", { digest: error.digest }) : t("errorGeneric")}
      >
        <Button variant="outline" size="sm" onClick={reset}>
          <RotateCcw className="size-4" /> {t("tryAgain")}
        </Button>
      </EmptyState>
    </div>
  );
}
