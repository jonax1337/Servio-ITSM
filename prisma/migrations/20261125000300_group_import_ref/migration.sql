/*
  Warnings:

  - A unique constraint covering the columns `[importRef]` on the table `Group` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Group" ADD COLUMN "importRef" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Group_importRef_key" ON "Group"("importRef");
