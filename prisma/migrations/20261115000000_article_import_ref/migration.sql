-- Article.importRef: origin key of an article maintained through the API (PUT /api/v1/articles/ref/{ref}).
ALTER TABLE "Article" ADD COLUMN "importRef" TEXT;
CREATE UNIQUE INDEX "Article_importRef_key" ON "Article"("importRef");
