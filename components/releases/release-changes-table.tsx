import Link from "next/link";
import { X } from "lucide-react";
import { format } from "date-fns";
import { removeChangeFromReleaseAction } from "@/lib/actions/releases";
import { ConfirmButton } from "@/components/confirm-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CHANGE_STATUS_META, CHANGE_TYPE_META, RISK_META, changeRef } from "@/lib/constants";

export type ReleaseChangeRow = {
  id: number;
  title: string;
  type: string;
  status: string;
  risk: string;
  plannedStart: Date | null;
};

/** The changes bundled in a release; `editable` adds a remove control per row. */
export function ReleaseChangesTable({
  releaseId,
  changes,
  editable,
}: {
  releaseId: number;
  changes: ReleaseChangeRow[];
  editable: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-[96px]">Ref</TableHead>
          <TableHead>Title</TableHead>
          <TableHead className="hidden md:table-cell">Type</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden md:table-cell">Risk</TableHead>
          <TableHead className="hidden text-right lg:table-cell">Planned start</TableHead>
          {editable ? <TableHead className="w-10"><span className="sr-only">Remove</span></TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {changes.map((change) => (
          <TableRow key={change.id} className="group">
            <TableCell className="font-mono text-xs text-muted-foreground">{changeRef(change.id)}</TableCell>
            <TableCell className="max-w-[360px]">
              <Link href={`/changes/${change.id}`} className="line-clamp-1 font-medium group-hover:text-primary">
                {change.title}
              </Link>
            </TableCell>
            <TableCell className="hidden md:table-cell">
              <StatusBadge map={CHANGE_TYPE_META} value={change.type} dot />
            </TableCell>
            <TableCell>
              <StatusBadge map={CHANGE_STATUS_META} value={change.status} />
            </TableCell>
            <TableCell className="hidden md:table-cell">
              <StatusBadge map={RISK_META} value={change.risk} dot />
            </TableCell>
            <TableCell className="hidden text-right text-xs tabular-nums text-muted-foreground lg:table-cell">
              {change.plannedStart ? format(change.plannedStart, "PP p") : "—"}
            </TableCell>
            {editable ? (
              <TableCell>
                <ConfirmButton
                  action={removeChangeFromReleaseAction}
                  fields={{ releaseId, changeId: change.id }}
                  title={`Remove ${changeRef(change.id)} from this release?`}
                  confirmLabel="Remove"
                  triggerVariant="ghost"
                  triggerLabel={`Remove ${changeRef(change.id)} from the release`}
                  successMessage="Change removed from the release"
                >
                  <X className="size-4" />
                </ConfirmButton>
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
