-- Attachment.importRef: source id of a file written by a history import (POST /api/v1/{entity}/{id}/attachments, import_ref).
ALTER TABLE "Attachment" ADD COLUMN "importRef" TEXT;
CREATE UNIQUE INDEX "Attachment_importRef_key" ON "Attachment"("importRef");
