"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { setReleaseStatusAction } from "@/lib/actions/releases";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-dialog";
import { useServerMessage, useT } from "@/lib/i18n/client";

export type ReleaseMove = {
  status: string;
  /** Why the move is refused right now (shown as a tooltip on the disabled button), or null. */
  blockedReason: string | null;
};


function MoveButton({ releaseId, move }: { releaseId: number; move: ReleaseMove }) {
  const [pending, start] = useTransition();
  const t = useT("releases");
  const tm = useServerMessage();
  const go = () => {
    const formData = new FormData();
    formData.set("id", String(releaseId));
    formData.set("status", move.status);
    start(async () => {
      const result = await setReleaseStatusAction(formData);
      if (result.ok) toast.success(t.dyn(`move.success.${move.status}`));
      else toast.error(result.error ? tm(result.error) : t("move.failed"));
    });
  };
  return (
    <Button
      type="button"
      size="sm"
      variant={move.status === "PLANNING" ? "outline" : "default"}
      disabled={pending || move.blockedReason !== null}
      title={move.blockedReason ?? undefined}
      onClick={go}
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {t.dyn(`move.label.${move.status}`)}
    </Button>
  );
}

/** The release's possible next statuses as buttons; cancelling asks for confirmation. */
export function ReleaseStatusActions({ releaseId, moves }: { releaseId: number; moves: ReleaseMove[] }) {
  const t = useT("releases");
  return (
    <>
      {moves.map((move) =>
        move.status === "CANCELLED" ? (
          <ConfirmButton
            key={move.status}
            action={setReleaseStatusAction}
            fields={{ id: releaseId, status: move.status }}
            title={t("move.cancelTitle")}
            description={t("move.cancelDescription")}
            confirmLabel={t("move.label.CANCELLED")}
            cancelLabel={t("move.keep")}
            triggerVariant="outline"
            triggerSize="sm"
            successMessage={t("move.success.CANCELLED")}
          >
            {t("move.label.CANCELLED")}
          </ConfirmButton>
        ) : (
          <MoveButton key={move.status} releaseId={releaseId} move={move} />
        ),
      )}
    </>
  );
}
