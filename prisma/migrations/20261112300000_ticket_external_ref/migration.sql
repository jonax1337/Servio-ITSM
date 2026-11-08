-- Monitoring dedup key on tickets: externalRef is kept for history, openExternalRef holds it only while
-- the ticket is open (unique => one open ticket per key).
ALTER TABLE "Ticket" ADD COLUMN "externalRef" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "openExternalRef" TEXT;

CREATE UNIQUE INDEX "Ticket_openExternalRef_key" ON "Ticket"("openExternalRef");

CREATE INDEX "Ticket_externalRef_idx" ON "Ticket"("externalRef");
