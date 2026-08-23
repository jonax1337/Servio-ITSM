import { FileQuestion } from "lucide-react";
import { LinkButton } from "@/components/link-button";
import { EmptyState } from "@/components/empty-state";

export default function NotFound() {
  return (
    <div className="grid min-h-svh place-items-center p-6">
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
