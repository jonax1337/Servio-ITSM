-- Source id of comments written by the history import (/api/v1/import/*): a re-run
-- (PUT /api/v1/import/{type}/{import_ref}) appends only comments it has not seen yet.
ALTER TABLE "TicketComment" ADD COLUMN "importRef" TEXT;
ALTER TABLE "ProblemComment" ADD COLUMN "importRef" TEXT;
ALTER TABLE "ChangeComment" ADD COLUMN "importRef" TEXT;

CREATE UNIQUE INDEX "TicketComment_ticketId_importRef_key" ON "TicketComment"("ticketId", "importRef");
CREATE UNIQUE INDEX "ProblemComment_problemId_importRef_key" ON "ProblemComment"("problemId", "importRef");
CREATE UNIQUE INDEX "ChangeComment_changeId_importRef_key" ON "ChangeComment"("changeId", "importRef");
