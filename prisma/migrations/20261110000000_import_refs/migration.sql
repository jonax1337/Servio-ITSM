-- Origin reference of records imported through /api/v1/import/* (history migration, idempotent re-runs).
ALTER TABLE "Ticket" ADD COLUMN "importRef" TEXT;
ALTER TABLE "Problem" ADD COLUMN "importRef" TEXT;
ALTER TABLE "Change" ADD COLUMN "importRef" TEXT;

CREATE UNIQUE INDEX "Ticket_importRef_key" ON "Ticket"("importRef");
CREATE UNIQUE INDEX "Problem_importRef_key" ON "Problem"("importRef");
CREATE UNIQUE INDEX "Change_importRef_key" ON "Change"("importRef");
