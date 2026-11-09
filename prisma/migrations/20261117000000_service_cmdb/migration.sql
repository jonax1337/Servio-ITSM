-- Services as CMDB objects: optional unique service number (code) and origin key (importRef, for
-- PUT /api/v1/services/ref/{ref}), plus service-to-service dependencies. Existing rows keep NULL
-- for both new columns, which the unique indexes allow any number of times.
-- AlterTable
ALTER TABLE "Service" ADD COLUMN "code" TEXT;
ALTER TABLE "Service" ADD COLUMN "importRef" TEXT;

-- CreateTable
CREATE TABLE "ServiceDependency" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromServiceId" TEXT NOT NULL,
    "toServiceId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceDependency_fromServiceId_fkey" FOREIGN KEY ("fromServiceId") REFERENCES "Service" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ServiceDependency_toServiceId_fkey" FOREIGN KEY ("toServiceId") REFERENCES "Service" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ServiceDependency_toServiceId_idx" ON "ServiceDependency"("toServiceId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceDependency_fromServiceId_toServiceId_key" ON "ServiceDependency"("fromServiceId", "toServiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Service_code_key" ON "Service"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Service_importRef_key" ON "Service"("importRef");

