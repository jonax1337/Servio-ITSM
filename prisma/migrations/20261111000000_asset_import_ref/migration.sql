-- Origin key for assets written through /api/v1/assets (upsert by reference, history import).
ALTER TABLE "Asset" ADD COLUMN "importRef" TEXT;

CREATE UNIQUE INDEX "Asset_importRef_key" ON "Asset"("importRef");
