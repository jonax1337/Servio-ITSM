"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { setReleaseStatusAction } from "@/lib/actions/releases";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-dialog";

export type ReleaseMove = {
  status: string;
  /** Why the move is refused right now (shown as a tooltip on the disabled button), or null. */
  blockedReason: string | null;
};

const MOVE_LABEL: Record<string, string> = {
  PLANNING: "Back to planning",
  READY: "Mark ready",
  IN_PROGRESS: "Start deployment",
  DEPLOYED: "Mark deployed",
  CANCELLED: "Cancel release",
};

const MOVE_SUCCESS: Record<string, string> = {
  PLANNING: "Release moved back to planning",
  READY: "Release is ready",
  IN_PROGRESS: "Deployment started",
  DEPLOYED: "Release deployed",
  CANCELLED: "Release cancelled",
};

function MoveButton({ releaseId, move }: { releaseId: number; move: ReleaseMove }) {
  const [pending, start] = useTransition();
  const go = () => {
    const formData = new FormData();
    formData.set("id", String(releaseId));
    formData.set("status", move.status);
    start(async () => {
      const result = await setReleaseStatusAction(formData);
      if (result.ok) toast.success(MOVE_SUCCESS[move.status]);
      else toast.error(result.error ?? "The release could not be moved.");
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
      {MOVE_LABEL[move.status]}
    </Button>
  );
}

/** The release's possible next statuses as buttons; cancelling asks for confirmation. */
export function ReleaseStatusActions({ releaseId, moves }: { releaseId: number; moves: ReleaseMove[] }) {
  return (
    <>
      {moves.map((move) =>
        move.status === "CANCELLED" ? (
          <ConfirmButton
            key={move.status}
            action={setReleaseStatusAction}
            fields={{ id: releaseId, status: move.status }}
            title="Cancel this release?"
            description="The bundled changes are released from it and can ship in another release."
            confirmLabel="Cancel release"
            cancelLabel="Keep release"
            triggerVariant="outline"
            triggerSize="sm"
            successMessage={MOVE_SUCCESS.CANCELLED}
          >
            {MOVE_LABEL.CANCELLED}
          </ConfirmButton>
        ) : (
          <MoveButton key={move.status} releaseId={releaseId} move={move} />
        ),
      )}
    </>
  );
}
