"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteLocation } from "@/lib/actions/locations";
import { ConfirmButton } from "@/components/confirm-dialog";

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

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
  const consequences = [
    assetCount > 0 ? `${plural(assetCount, "asset")} will lose their location` : null,
    childCount > 0 ? `${plural(childCount, "sub-location")} will move to the top level` : null,
  ].filter(Boolean);

  return (
    <ConfirmButton
      action={async (fd) => {
        const res = await deleteLocation(fd);
        if (res.ok) router.push("/locations");
        return res;
      }}
      fields={{ id }}
      title="Delete location"
      description={`Delete "${name}"? ${consequences.length > 0 ? `${consequences.join(" and ")}. ` : ""}This can't be undone.`}
      triggerLabel="Delete location"
      triggerVariant="outline"
      triggerClassName="text-muted-foreground hover:border-destructive/40 hover:text-destructive"
    >
      <Trash2 className="size-4" />
    </ConfirmButton>
  );
}
