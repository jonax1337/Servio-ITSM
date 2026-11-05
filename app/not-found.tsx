import { FileQuestion } from "lucide-react";
import { LinkButton } from "@/components/link-button";
import { EmptyState } from "@/components/empty-state";
import { Wordmark } from "@/components/brand";

export default function NotFound() {
  return (
    <div className="grid min-h-svh place-content-center justify-items-center gap-10 p-6">
      <Wordmark />
      <EmptyState
        icon={FileQuestion}
        title="Page not found"
        description="The page you are looking for doesn't exist or may have moved."
        className="max-w-md"
      >
        <LinkButton href="/" variant="outline" size="sm">
          Back to home
        </LinkButton>
      </EmptyState>
    </div>
  );
}
