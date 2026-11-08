"use client";

import { useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { toggleCatalogPublished } from "@/lib/actions/catalog-admin";
import { useT } from "@/lib/i18n/client";

export function PublishToggle({ id, published }: { id: string; published: boolean }) {
  const [pending, start] = useTransition();
  const t = useT("catalog");
  return (
    <Switch
      checked={published}
      disabled={pending}
      aria-label={t("togglePublished")}
      onCheckedChange={() => {
        const fd = new FormData();
        fd.set("id", id);
        start(() => toggleCatalogPublished(fd));
      }}
    />
  );
}
