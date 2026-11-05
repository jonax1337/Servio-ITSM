-- CreateTable
CREATE TABLE "AiSkill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AiMcpServer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "transport" TEXT NOT NULL DEFAULT 'http',
    "headers" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'APPROVAL',
    "minRole" TEXT NOT NULL DEFAULT 'AGENT',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AiProposalDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "proposalKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "claimId" TEXT,
    "summary" TEXT,
    "decidedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiProposalDecision_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AiSkill_name_key" ON "AiSkill"("name");

-- CreateIndex
CREATE UNIQUE INDEX "AiMcpServer_name_key" ON "AiMcpServer"("name");

-- CreateIndex
CREATE UNIQUE INDEX "AiProposalDecision_conversationId_proposalKey_key" ON "AiProposalDecision"("conversationId", "proposalKey");

