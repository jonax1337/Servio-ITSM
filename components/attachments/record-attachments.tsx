import { db } from "@/lib/db";
import { AttachmentsCard } from "@/components/attachments/attachments-card";
import { getMaxUploadMb } from "@/lib/settings";
import { mayWriteRecordAttachment, type RecordTargetKind } from "@/lib/attachment-rules";

type RecordTarget = { changeId: number } | { problemId: number } | { assetId: string } | { licenseId: string };

function kindOf(target: RecordTarget): RecordTargetKind {
  if ("changeId" in target) return "change";
  if ("problemId" in target) return "problem";
  if ("assetId" in target) return "asset";
  return "license";
}

/**
 * The files of a change, problem, asset or license, for the detail page's rail
 * (Server Component, loads its own rows). Agents read them; uploading and
 * removing follows the server rule (any agent, licenses MANAGER+), so the
 * upload route and deleteAttachment would refuse what this hides anyway.
 * Files also arrive through the REST API (/api/v1/{entity}/{id}/attachments).
 */
export async function RecordAttachments({ target, role, className }: { target: RecordTarget; role: string; className?: string }) {
  const [attachments, maxMb] = await Promise.all([
    db.attachment.findMany({
      where: target,
      orderBy: { createdAt: "desc" },
      select: { id: true, filename: true, mime: true, size: true, createdAt: true, uploadedById: true },
    }),
    getMaxUploadMb(),
  ]);
  const canWrite = mayWriteRecordAttachment(role, kindOf(target));
  if (attachments.length === 0 && !canWrite) return null;
  return <AttachmentsCard className={className} attachments={attachments} target={target} canUpload={canWrite} canDeleteAll={canWrite} maxMb={maxMb} />;
}
