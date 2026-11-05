-- AlterTable
ALTER TABLE "Change" ADD COLUMN "cancelReason" TEXT;
ALTER TABLE "Change" ADD COLUMN "closureNotes" TEXT;
ALTER TABLE "Change" ADD COLUMN "outcome" TEXT;

-- CreateTable
CREATE TABLE "ServiceAsset" (
    "serviceId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("serviceId", "assetId"),
    CONSTRAINT "ServiceAsset_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ServiceAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ArticleLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArticleLink_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArticleLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ArticleLink_entityType_entityId_idx" ON "ArticleLink"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleLink_articleId_entityType_entityId_key" ON "ArticleLink"("articleId", "entityType", "entityId");

