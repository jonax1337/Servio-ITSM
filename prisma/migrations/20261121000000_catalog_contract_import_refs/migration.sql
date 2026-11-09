-- Catalog items, change templates, contracts and vendors: an origin key (importRef) for upserts through the API;
-- catalog items also get an optional routing team (groupId). Nullable columns, so existing rows need no backfill.
-- AlterTable
ALTER TABLE "ChangeTemplate" ADD COLUMN "importRef" TEXT;

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN "importRef" TEXT;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN "importRef" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CatalogItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "shortDescription" TEXT,
    "icon" TEXT,
    "categoryId" TEXT,
    "serviceId" TEXT,
    "groupId" TEXT,
    "formSchema" TEXT NOT NULL DEFAULT '[]',
    "ticketType" TEXT NOT NULL DEFAULT 'REQUEST',
    "titleTemplate" TEXT,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "approverId" TEXT,
    "approvalStages" TEXT,
    "estimatedDays" INTEGER,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "importRef" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CatalogItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CatalogItem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CatalogItem_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CatalogItem_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CatalogItem" ("approvalStages", "approverId", "categoryId", "createdAt", "description", "estimatedDays", "formSchema", "icon", "id", "isPublished", "name", "order", "requiresApproval", "serviceId", "shortDescription", "ticketType", "titleTemplate", "updatedAt") SELECT "approvalStages", "approverId", "categoryId", "createdAt", "description", "estimatedDays", "formSchema", "icon", "id", "isPublished", "name", "order", "requiresApproval", "serviceId", "shortDescription", "ticketType", "titleTemplate", "updatedAt" FROM "CatalogItem";
DROP TABLE "CatalogItem";
ALTER TABLE "new_CatalogItem" RENAME TO "CatalogItem";
CREATE UNIQUE INDEX "CatalogItem_importRef_key" ON "CatalogItem"("importRef");
CREATE INDEX "CatalogItem_isPublished_idx" ON "CatalogItem"("isPublished");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ChangeTemplate_importRef_key" ON "ChangeTemplate"("importRef");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_importRef_key" ON "Contract"("importRef");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_importRef_key" ON "Vendor"("importRef");

