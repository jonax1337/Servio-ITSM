-- CreateTable
CREATE TABLE "MaintenanceWindow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'GENERAL',
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "announceHours" INTEGER NOT NULL DEFAULT 24,
    "blockAccess" BOOLEAN NOT NULL DEFAULT true,
    "targetVersion" TEXT,
    "fromVersion" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "result" TEXT,
    "log" TEXT NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MaintenanceWindow_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MaintenanceWindow_status_startsAt_idx" ON "MaintenanceWindow"("status", "startsAt");
