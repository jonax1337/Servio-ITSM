-- Service accounts: a non-human account (integration, break-glass admin, automation) receives no email and never
-- sits on a change approval board; canApproveChanges is the explicit per-account switch for the board.
-- Plain ADD COLUMN with a constant default (no rebuild of the heavily referenced User table): every existing
-- account stays a regular account that may approve, so no existing board changes.
-- AlterTable
ALTER TABLE "User" ADD COLUMN "isServiceAccount" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "canApproveChanges" BOOLEAN NOT NULL DEFAULT true;
