-- CreateTable
CREATE TABLE "ProblemAsset" (
    "problemId" INTEGER NOT NULL,
    "assetId" TEXT NOT NULL,

    PRIMARY KEY ("problemId", "assetId"),
    CONSTRAINT "ProblemAsset_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProblemAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ProblemAsset_assetId_idx" ON "ProblemAsset"("assetId");

