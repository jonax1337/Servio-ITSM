-- Per-person email copies of in-app notifications (Account settings > Notifications).
-- NULL = the defaults in lib/notification-email-rules.ts.
-- AlterTable
ALTER TABLE "User" ADD COLUMN "emailNotifications" TEXT;
