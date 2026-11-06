-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Attachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filename" TEXT NOT NULL,
    "url" TEXT,
    "storageKey" TEXT,
    "checksum" TEXT,
    "mime" TEXT NOT NULL DEFAULT 'application/octet-stream',
    "size" REAL NOT NULL DEFAULT 0,
    "ticketId" INTEGER,
    "commentId" TEXT,
    "articleId" TEXT,
    "uploadedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attachment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attachment_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "TicketComment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attachment_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Attachment" ("articleId", "checksum", "commentId", "createdAt", "filename", "id", "mime", "size", "storageKey", "ticketId", "uploadedById", "url") SELECT "articleId", "checksum", "commentId", "createdAt", "filename", "id", "mime", "size", "storageKey", "ticketId", "uploadedById", "url" FROM "Attachment";
DROP TABLE "Attachment";
ALTER TABLE "new_Attachment" RENAME TO "Attachment";
CREATE INDEX "Attachment_ticketId_idx" ON "Attachment"("ticketId");
CREATE INDEX "Attachment_commentId_idx" ON "Attachment"("commentId");
CREATE INDEX "Attachment_articleId_idx" ON "Attachment"("articleId");
CREATE INDEX "Attachment_uploadedById_idx" ON "Attachment"("uploadedById");
CREATE INDEX "Attachment_storageKey_idx" ON "Attachment"("storageKey");
CREATE TABLE "new_Ticket" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "descriptionHtml" TEXT,
    "type" TEXT NOT NULL DEFAULT 'INCIDENT',
    "prefix" TEXT NOT NULL DEFAULT 'INC',
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "impact" TEXT NOT NULL DEFAULT 'MEDIUM',
    "urgency" TEXT NOT NULL DEFAULT 'MEDIUM',
    "source" TEXT NOT NULL DEFAULT 'PORTAL',
    "isMajorIncident" BOOLEAN NOT NULL DEFAULT false,
    "pendingReason" TEXT,
    "pendingNote" TEXT,
    "resolutionCode" TEXT,
    "resolutionNote" TEXT,
    "mergedIntoId" INTEGER,
    "parentId" INTEGER,
    "requesterId" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "assigneeId" TEXT,
    "groupId" TEXT,
    "categoryId" TEXT,
    "serviceId" TEXT,
    "catalogItemId" TEXT,
    "slaId" TEXT,
    "problemId" INTEGER,
    "changeId" INTEGER,
    "formData" TEXT,
    "formSchema" TEXT,
    "customFields" TEXT NOT NULL DEFAULT '{}',
    "approvalState" TEXT,
    "dueDate" DATETIME,
    "dueAt" DATETIME,
    "responseDueAt" DATETIME,
    "resolveDueAt" DATETIME,
    "responseBreached" BOOLEAN NOT NULL DEFAULT false,
    "resolveBreached" BOOLEAN NOT NULL DEFAULT false,
    "pendingSince" DATETIME,
    "pausedMs" REAL NOT NULL DEFAULT 0,
    "escalatedAt" DATETIME,
    "slaAtRiskNotifiedAt" DATETIME,
    "slaNudgedAt" DATETIME,
    "firstResponseAt" DATETIME,
    "resolvedAt" DATETIME,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Ticket_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Ticket_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Ticket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Ticket_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Ticket_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Ticket_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Ticket_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Ticket_slaId_fkey" FOREIGN KEY ("slaId") REFERENCES "SLA" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Ticket_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Ticket_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "Change" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Ticket_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Ticket" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Ticket_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Ticket" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Ticket" ("approvalState", "assigneeId", "catalogItemId", "categoryId", "changeId", "closedAt", "createdAt", "customFields", "description", "descriptionHtml", "dueAt", "dueDate", "escalatedAt", "firstResponseAt", "formData", "formSchema", "groupId", "id", "impact", "isMajorIncident", "mergedIntoId", "parentId", "pausedMs", "pendingNote", "pendingReason", "pendingSince", "prefix", "priority", "problemId", "requestedByUserId", "requesterId", "resolutionCode", "resolutionNote", "resolveBreached", "resolveDueAt", "resolvedAt", "responseBreached", "responseDueAt", "serviceId", "slaAtRiskNotifiedAt", "slaId", "slaNudgedAt", "source", "status", "title", "type", "updatedAt", "urgency") SELECT "approvalState", "assigneeId", "catalogItemId", "categoryId", "changeId", "closedAt", "createdAt", "customFields", "description", "descriptionHtml", "dueAt", "dueDate", "escalatedAt", "firstResponseAt", "formData", "formSchema", "groupId", "id", "impact", "isMajorIncident", "mergedIntoId", "parentId", "pausedMs", "pendingNote", "pendingReason", "pendingSince", "prefix", "priority", "problemId", "requestedByUserId", "requesterId", "resolutionCode", "resolutionNote", "resolveBreached", "resolveDueAt", "resolvedAt", "responseBreached", "responseDueAt", "serviceId", "slaAtRiskNotifiedAt", "slaId", "slaNudgedAt", "source", "status", "title", "type", "updatedAt", "urgency" FROM "Ticket";
DROP TABLE "Ticket";
ALTER TABLE "new_Ticket" RENAME TO "Ticket";
CREATE INDEX "Ticket_status_idx" ON "Ticket"("status");
CREATE INDEX "Ticket_priority_idx" ON "Ticket"("priority");
CREATE INDEX "Ticket_assigneeId_idx" ON "Ticket"("assigneeId");
CREATE INDEX "Ticket_requesterId_idx" ON "Ticket"("requesterId");
CREATE INDEX "Ticket_requestedByUserId_idx" ON "Ticket"("requestedByUserId");
CREATE INDEX "Ticket_groupId_idx" ON "Ticket"("groupId");
CREATE INDEX "Ticket_parentId_idx" ON "Ticket"("parentId");
CREATE INDEX "Ticket_createdAt_idx" ON "Ticket"("createdAt");
CREATE INDEX "Ticket_resolvedAt_idx" ON "Ticket"("resolvedAt");
CREATE INDEX "Ticket_resolveDueAt_idx" ON "Ticket"("resolveDueAt");
CREATE INDEX "Ticket_updatedAt_idx" ON "Ticket"("updatedAt");
CREATE INDEX "Ticket_serviceId_idx" ON "Ticket"("serviceId");
CREATE INDEX "Ticket_categoryId_idx" ON "Ticket"("categoryId");
CREATE INDEX "Ticket_slaId_idx" ON "Ticket"("slaId");
CREATE INDEX "Ticket_problemId_idx" ON "Ticket"("problemId");
CREATE INDEX "Ticket_changeId_idx" ON "Ticket"("changeId");
CREATE INDEX "Ticket_mergedIntoId_idx" ON "Ticket"("mergedIntoId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

