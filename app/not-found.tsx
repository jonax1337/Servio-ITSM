import { FileQuestion } from "lucide-react";
import { LinkButton } from "@/components/link-button";
import { EmptyState } from "@/components/empty-state";
import { Wordmark } from "@/components/brand";
import { getT } from "@/lib/i18n/server";

export default async function NotFound() {
  const t = await getT("errors");
  return (
    <div className="grid min-h-svh place-content-center justify-items-center gap-10 p-6">
      <Wordmark />
      <EmptyState
        icon={FileQuestion}
        title={t("notFoundTitle")}
        description={t("notFoundText")}
        className="max-w-md"
      >
        <LinkButton href="/" variant="outline" size="sm">
          {t("backToHome")}
        </LinkButton>
      </EmptyState>
    </div>
  );
}
