"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setArticleStatus } from "@/lib/actions/knowledge";
import { useServerMessage, useT } from "@/lib/i18n/client";

/** One article lifecycle button: runs the status change and toasts the outcome. */
export function ArticleStatusButton({
  id,
  to,
  successMessage,
  variant = "outline",
  children,
}: {
  id: string;
  to: string;
  successMessage: string;
  variant?: "default" | "outline";
  children: React.ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  const t = useT("knowledge");
  const tm = useServerMessage();

  const move = () => {
    const formData = new FormData();
    formData.set("id", id);
    formData.set("status", to);
    startTransition(async () => {
      const result = await setArticleStatus(formData);
      if (result.ok) toast.success(successMessage);
      else toast.error(result.error ? tm(result.error) : t("statusChangeFailed"));
    });
  };

  return (
    <Button type="button" size="sm" variant={variant} onClick={move} disabled={pending}>
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
      {children}
    </Button>
  );
}
