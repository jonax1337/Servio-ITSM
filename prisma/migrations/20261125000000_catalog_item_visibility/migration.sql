-- Catalog items can be restricted to members of selected groups (CatalogItemGroup). Existing items stay visible to everyone
-- (restrictToGroups defaults to false); the new table starts empty, so no backfill is needed.
-- CreateTable
CREATE TABLE "CatalogItemGroup" (
    "catalogItemId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,

    PRIMARY KEY ("catalogItemId", "groupId"),
    CONSTRAINT "CatalogItemGroup_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CatalogItemGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
    "restrictToGroups" BOOLEAN NOT NULL DEFAULT false,
    "importRef" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CatalogItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CatalogItem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CatalogItem_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CatalogItem_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CatalogItem" ("approvalStages", "approverId", "categoryId", "createdAt", "description", "estimatedDays", "formSchema", "groupId", "icon", "id", "importRef", "isPublished", "name", "order", "requiresApproval", "serviceId", "shortDescription", "ticketType", "titleTemplate", "updatedAt") SELECT "approvalStages", "approverId", "categoryId", "createdAt", "description", "estimatedDays", "formSchema", "groupId", "icon", "id", "importRef", "isPublished", "name", "order", "requiresApproval", "serviceId", "shortDescription", "ticketType", "titleTemplate", "updatedAt" FROM "CatalogItem";
DROP TABLE "CatalogItem";
ALTER TABLE "new_CatalogItem" RENAME TO "CatalogItem";
CREATE UNIQUE INDEX "CatalogItem_importRef_key" ON "CatalogItem"("importRef");
CREATE INDEX "CatalogItem_isPublished_idx" ON "CatalogItem"("isPublished");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "CatalogItemGroup_groupId_idx" ON "CatalogItemGroup"("groupId");
