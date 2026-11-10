/*
  Warnings:

  - A unique constraint covering the columns `[importRef]` on the table `BusinessCalendar` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[importRef]` on the table `SLA` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "BusinessCalendar" ADD COLUMN "holidayRegion" TEXT;
ALTER TABLE "BusinessCalendar" ADD COLUMN "importRef" TEXT;

-- AlterTable
ALTER TABLE "Holiday" ADD COLUMN "generated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SLA" ADD COLUMN "importRef" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "BusinessCalendar_importRef_key" ON "BusinessCalendar"("importRef");

-- CreateIndex
CREATE UNIQUE INDEX "SLA_importRef_key" ON "SLA"("importRef");
