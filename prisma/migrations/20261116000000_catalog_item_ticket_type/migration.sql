-- Catalog items: what a request becomes (REQUEST | INCIDENT) and an optional ticket title template.
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
    "formSchema" TEXT NOT NULL DEFAULT '[]',
    "ticketType" TEXT NOT NULL DEFAULT 'REQUEST',
    "titleTemplate" TEXT,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "approverId" TEXT,
    "approvalStages" TEXT,
    "estimatedDays" INTEGER,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CatalogItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CatalogItem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CatalogItem_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CatalogItem" ("approvalStages", "approverId", "categoryId", "createdAt", "description", "estimatedDays", "formSchema", "icon", "id", "isPublished", "name", "order", "requiresApproval", "serviceId", "shortDescription", "updatedAt") SELECT "approvalStages", "approverId", "categoryId", "createdAt", "description", "estimatedDays", "formSchema", "icon", "id", "isPublished", "name", "order", "requiresApproval", "serviceId", "shortDescription", "updatedAt" FROM "CatalogItem";
DROP TABLE "CatalogItem";
ALTER TABLE "new_CatalogItem" RENAME TO "CatalogItem";
CREATE INDEX "CatalogItem_isPublished_idx" ON "CatalogItem"("isPublished");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

