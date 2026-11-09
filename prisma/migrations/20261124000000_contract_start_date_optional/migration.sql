-- A contract recorded after the fact often has no known start date: Contract.startDate becomes optional.
-- Existing rows keep their value (plain copy into the redefined table); only endDate drives renewals.
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Contract" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "number" TEXT,
    "type" TEXT NOT NULL DEFAULT 'SUPPORT',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "vendorId" TEXT,
    "ownerId" TEXT,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "cost" REAL,
    "renewalNoticeDays" INTEGER NOT NULL DEFAULT 30,
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "renewalNotifiedFor" DATETIME,
    "importRef" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Contract_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Contract_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Contract" ("autoRenew", "cost", "createdAt", "endDate", "id", "importRef", "name", "notes", "number", "ownerId", "renewalNoticeDays", "renewalNotifiedFor", "startDate", "status", "type", "updatedAt", "vendorId") SELECT "autoRenew", "cost", "createdAt", "endDate", "id", "importRef", "name", "notes", "number", "ownerId", "renewalNoticeDays", "renewalNotifiedFor", "startDate", "status", "type", "updatedAt", "vendorId" FROM "Contract";
DROP TABLE "Contract";
ALTER TABLE "new_Contract" RENAME TO "Contract";
CREATE UNIQUE INDEX "Contract_importRef_key" ON "Contract"("importRef");
CREATE INDEX "Contract_endDate_idx" ON "Contract"("endDate");
CREATE INDEX "Contract_vendorId_idx" ON "Contract"("vendorId");
CREATE INDEX "Contract_status_idx" ON "Contract"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

