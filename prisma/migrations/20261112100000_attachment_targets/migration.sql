-- Attachments on changes, problems, assets and licenses (REST API /{entity}/{id}/attachments and the console rails).
-- SQLite cannot add foreign keys to an existing table, so the table is rebuilt (Prisma's RedefineTables pattern).
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Attachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filename" TEXT NOT NULL,
    "url" TEXT,
    "storageKey" TEXT,
    "checksum" TEXT,
    "mime" TEXT NOT NULL DEFAULT 'application/octet-stream',
    "size" REAL NOT NULL DEFAULT 0,
    "ticketId" INTEGER,
    "commentId" TEXT,
    "articleId" TEXT,
    "changeId" INTEGER,
    "problemId" INTEGER,
    "assetId" TEXT,
    "licenseId" TEXT,
    "uploadedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attachment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attachment_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "TicketComment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attachment_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attachment_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "Change" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attachment_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attachment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attachment_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "SoftwareLicense" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Attachment" ("articleId", "checksum", "commentId", "createdAt", "filename", "id", "mime", "size", "storageKey", "ticketId", "uploadedById", "url") SELECT "articleId", "checksum", "commentId", "createdAt", "filename", "id", "mime", "size", "storageKey", "ticketId", "uploadedById", "url" FROM "Attachment";
DROP TABLE "Attachment";
ALTER TABLE "new_Attachment" RENAME TO "Attachment";
CREATE INDEX "Attachment_ticketId_idx" ON "Attachment"("ticketId");
CREATE INDEX "Attachment_commentId_idx" ON "Attachment"("commentId");
CREATE INDEX "Attachment_articleId_idx" ON "Attachment"("articleId");
CREATE INDEX "Attachment_changeId_idx" ON "Attachment"("changeId");
CREATE INDEX "Attachment_problemId_idx" ON "Attachment"("problemId");
CREATE INDEX "Attachment_assetId_idx" ON "Attachment"("assetId");
CREATE INDEX "Attachment_licenseId_idx" ON "Attachment"("licenseId");
CREATE INDEX "Attachment_uploadedById_idx" ON "Attachment"("uploadedById");
CREATE INDEX "Attachment_storageKey_idx" ON "Attachment"("storageKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

