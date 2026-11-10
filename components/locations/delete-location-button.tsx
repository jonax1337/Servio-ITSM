"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteLocation } from "@/lib/actions/locations";
import { ConfirmButton } from "@/components/confirm-dialog";
import { useT } from "@/lib/i18n/client";

/** Deletes a location behind a confirmation that spells out what gets detached. */
export function DeleteLocationButton({
  id, name, assetCount, childCount,
}: {
  id: string;
  name: string;
  assetCount: number;
  childCount: number;
}) {
  const router = useRouter();
  const t = useT("locations");
  const consequences = [
    assetCount > 0 ? t("delete.assetsLose", { count: assetCount }) : null,
    childCount > 0 ? t("delete.childrenMove", { count: childCount }) : null,
  ].filter(Boolean);

  return (
    <ConfirmButton
      action={async (fd) => {
        const res = await deleteLocation(fd);
        if (res.ok) router.push("/locations");
        return res;
      }}
      fields={{ id }}
      title={t("delete.title")}
      description={t("delete.description", {
        name,
        consequences: consequences.length > 0 ? `${consequences.join(t("delete.and"))}. ` : "",
      })}
      triggerLabel={t("delete.title")}
      triggerVariant="outline"
      triggerSize="icon"
      triggerClassName="text-muted-foreground hover:border-destructive/40 hover:text-destructive"
    >
      <Trash2 className="size-4" />
    </ConfirmButton>
  );
}
