-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN "slaNudgedAt" DATETIME;

-- CreateTable
CREATE TABLE "ChangeFreezeWindow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "reason" TEXT,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "serviceId" TEXT,
    "groupId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChangeFreezeWindow_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChangeFreezeWindow_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OnCallSchedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "groupId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "rotationType" TEXT NOT NULL DEFAULT 'WEEKLY',
    "customIntervalHours" INTEGER,
    "handoffTime" TEXT NOT NULL DEFAULT '09:00',
    "rotationStart" DATETIME NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OnCallSchedule_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OnCallMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "OnCallMember_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "OnCallSchedule" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OnCallMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OnCallOverride" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "replacesUserId" TEXT,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OnCallOverride_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "OnCallSchedule" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OnCallOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OnCallOverride_replacesUserId_fkey" FOREIGN KEY ("replacesUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StatusIncident" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "state" TEXT NOT NULL DEFAULT 'INVESTIGATING',
    "impact" TEXT NOT NULL DEFAULT 'MINOR',
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "ticketId" INTEGER,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" DATETIME,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StatusIncident_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StatusIncidentService" (
    "incidentId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,

    PRIMARY KEY ("incidentId", "serviceId"),
    CONSTRAINT "StatusIncidentService_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "StatusIncident" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StatusIncidentService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StatusIncidentUpdate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StatusIncidentUpdate_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "StatusIncident" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StatusIncidentUpdate_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Release" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNING',
    "ownerId" TEXT,
    "groupId" TEXT,
    "deployedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Release_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Release_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChangeTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "summary" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "type" TEXT NOT NULL DEFAULT 'STANDARD',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "reason" TEXT,
    "implementationPlan" TEXT,
    "rollbackPlan" TEXT,
    "risk" TEXT NOT NULL DEFAULT 'LOW',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "impact" TEXT NOT NULL DEFAULT 'MEDIUM',
    "categoryId" TEXT,
    "serviceId" TEXT,
    "groupId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChangeTemplate_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ChangeTemplate_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ChangeTemplate_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "number" TEXT,
    "type" TEXT NOT NULL DEFAULT 'SUPPORT',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "vendorId" TEXT,
    "ownerId" TEXT,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME,
    "cost" REAL,
    "renewalNoticeDays" INTEGER NOT NULL DEFAULT 30,
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "renewalNotifiedFor" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Contract_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Contract_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContractAsset" (
    "contractId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("contractId", "assetId"),
    CONSTRAINT "ContractAsset_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContractAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SoftwareLicense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "vendorId" TEXT,
    "contractId" TEXT,
    "ownerId" TEXT,
    "licenseType" TEXT NOT NULL DEFAULT 'PER_USER',
    "seats" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" DATETIME,
    "cost" REAL,
    "notes" TEXT,
    "overAllocatedNotifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SoftwareLicense_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SoftwareLicense_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SoftwareLicense_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LicenseAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "licenseId" TEXT NOT NULL,
    "userId" TEXT,
    "assetId" TEXT,
    "assignedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LicenseAssignment_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "SoftwareLicense" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LicenseAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LicenseAssignment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiInsight" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "dedupeKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "problemId" INTEGER,
    "articleId" TEXT,
    "dismissedById" TEXT,
    "dismissedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiInsight_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AiInsight_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AiInsight_dismissedById_fkey" FOREIGN KEY ("dismissedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiInsightTicket" (
    "insightId" TEXT NOT NULL,
    "ticketId" INTEGER NOT NULL,

    PRIMARY KEY ("insightId", "ticketId"),
    CONSTRAINT "AiInsightTicket_insightId_fkey" FOREIGN KEY ("insightId") REFERENCES "AiInsight" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AiInsightTicket_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Change" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "descriptionHtml" TEXT,
    "type" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "risk" TEXT NOT NULL DEFAULT 'MEDIUM',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "impact" TEXT NOT NULL DEFAULT 'MEDIUM',
    "reason" TEXT,
    "implementationPlan" TEXT,
    "rollbackPlan" TEXT,
    "outcome" TEXT,
    "closureNotes" TEXT,
    "cancelReason" TEXT,
    "approvalRule" TEXT NOT NULL DEFAULT 'UNANIMOUS',
    "approvalThreshold" INTEGER,
    "customFields" TEXT NOT NULL DEFAULT '{}',
    "assigneeId" TEXT,
    "createdById" TEXT,
    "groupId" TEXT,
    "categoryId" TEXT,
    "problemId" INTEGER,
    "releaseId" INTEGER,
    "templateId" TEXT,
    "plannedStart" DATETIME,
    "plannedEnd" DATETIME,
    "actualStart" DATETIME,
    "actualEnd" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Change_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Change_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Change_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Change_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Change_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Change_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Change_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChangeTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Change" ("actualEnd", "actualStart", "approvalRule", "approvalThreshold", "assigneeId", "cancelReason", "categoryId", "closureNotes", "createdAt", "createdById", "customFields", "description", "descriptionHtml", "groupId", "id", "impact", "implementationPlan", "outcome", "plannedEnd", "plannedStart", "priority", "problemId", "reason", "risk", "rollbackPlan", "status", "title", "type", "updatedAt") SELECT "actualEnd", "actualStart", "approvalRule", "approvalThreshold", "assigneeId", "cancelReason", "categoryId", "closureNotes", "createdAt", "createdById", "customFields", "description", "descriptionHtml", "groupId", "id", "impact", "implementationPlan", "outcome", "plannedEnd", "plannedStart", "priority", "problemId", "reason", "risk", "rollbackPlan", "status", "title", "type", "updatedAt" FROM "Change";
DROP TABLE "Change";
ALTER TABLE "new_Change" RENAME TO "Change";
CREATE INDEX "Change_status_idx" ON "Change"("status");
CREATE INDEX "Change_releaseId_idx" ON "Change"("releaseId");
CREATE INDEX "Change_plannedStart_plannedEnd_idx" ON "Change"("plannedStart", "plannedEnd");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ChangeFreezeWindow_startsAt_endsAt_idx" ON "ChangeFreezeWindow"("startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "ChangeFreezeWindow_serviceId_idx" ON "ChangeFreezeWindow"("serviceId");

-- CreateIndex
CREATE INDEX "ChangeFreezeWindow_groupId_idx" ON "ChangeFreezeWindow"("groupId");

-- CreateIndex
CREATE INDEX "OnCallSchedule_groupId_isActive_idx" ON "OnCallSchedule"("groupId", "isActive");

-- CreateIndex
CREATE INDEX "OnCallMember_scheduleId_position_idx" ON "OnCallMember"("scheduleId", "position");

-- CreateIndex
CREATE INDEX "OnCallMember_userId_idx" ON "OnCallMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OnCallMember_scheduleId_userId_key" ON "OnCallMember"("scheduleId", "userId");

-- CreateIndex
CREATE INDEX "OnCallOverride_scheduleId_startsAt_endsAt_idx" ON "OnCallOverride"("scheduleId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "OnCallOverride_userId_idx" ON "OnCallOverride"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StatusIncident_ticketId_key" ON "StatusIncident"("ticketId");

-- CreateIndex
CREATE INDEX "StatusIncident_isPublic_state_idx" ON "StatusIncident"("isPublic", "state");

-- CreateIndex
CREATE INDEX "StatusIncident_startedAt_idx" ON "StatusIncident"("startedAt");

-- CreateIndex
CREATE INDEX "StatusIncidentService_serviceId_idx" ON "StatusIncidentService"("serviceId");

-- CreateIndex
CREATE INDEX "StatusIncidentUpdate_incidentId_createdAt_idx" ON "StatusIncidentUpdate"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "Release_status_idx" ON "Release"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeTemplate_name_key" ON "ChangeTemplate"("name");

-- CreateIndex
CREATE INDEX "ChangeTemplate_isActive_idx" ON "ChangeTemplate"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_name_key" ON "Vendor"("name");

-- CreateIndex
CREATE INDEX "Contract_endDate_idx" ON "Contract"("endDate");

-- CreateIndex
CREATE INDEX "Contract_vendorId_idx" ON "Contract"("vendorId");

-- CreateIndex
CREATE INDEX "Contract_status_idx" ON "Contract"("status");

-- CreateIndex
CREATE INDEX "ContractAsset_assetId_idx" ON "ContractAsset"("assetId");

-- CreateIndex
CREATE INDEX "SoftwareLicense_vendorId_idx" ON "SoftwareLicense"("vendorId");

-- CreateIndex
CREATE INDEX "SoftwareLicense_contractId_idx" ON "SoftwareLicense"("contractId");

-- CreateIndex
CREATE INDEX "SoftwareLicense_expiresAt_idx" ON "SoftwareLicense"("expiresAt");

-- CreateIndex
CREATE INDEX "LicenseAssignment_licenseId_idx" ON "LicenseAssignment"("licenseId");

-- CreateIndex
CREATE INDEX "LicenseAssignment_userId_idx" ON "LicenseAssignment"("userId");

-- CreateIndex
CREATE INDEX "LicenseAssignment_assetId_idx" ON "LicenseAssignment"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "AiInsight_dedupeKey_key" ON "AiInsight"("dedupeKey");

-- CreateIndex
CREATE INDEX "AiInsight_kind_status_idx" ON "AiInsight"("kind", "status");

-- CreateIndex
CREATE INDEX "AiInsight_createdAt_idx" ON "AiInsight"("createdAt");

-- CreateIndex
CREATE INDEX "AiInsightTicket_ticketId_idx" ON "AiInsightTicket"("ticketId");
