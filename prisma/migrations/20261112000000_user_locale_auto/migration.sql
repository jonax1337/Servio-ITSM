-- i18n (#63): User.locale "auto" follows the instance default language (Settings > General,
-- env APP_LOCALE). The language picker had no effect before this release, so the old
-- default "en" was never a deliberate choice: those rows follow the instance default now.
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "image" TEXT,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "isVip" BOOLEAN NOT NULL DEFAULT false,
    "jobTitle" TEXT,
    "phone" TEXT,
    "department" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "locale" TEXT NOT NULL DEFAULT 'auto',
    "signature" TEXT,
    "signatureEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "syncSourceId" TEXT,
    "externalId" TEXT,
    "lastLoginAt" DATETIME,
    "emailVerified" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_syncSourceId_fkey" FOREIGN KEY ("syncSourceId") REFERENCES "SyncSource" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("createdAt", "department", "email", "emailVerified", "externalId", "id", "image", "isActive", "isVip", "jobTitle", "lastLoginAt", "locale", "name", "passwordHash", "phone", "role", "signature", "signatureEnabled", "syncSourceId", "timezone", "updatedAt") SELECT "createdAt", "department", "email", "emailVerified", "externalId", "id", "image", "isActive", "isVip", "jobTitle", "lastLoginAt", "locale", "name", "passwordHash", "phone", "role", "signature", "signatureEnabled", "syncSourceId", "timezone", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_role_idx" ON "User"("role");
CREATE INDEX "User_syncSourceId_idx" ON "User"("syncSourceId");
CREATE INDEX "User_externalId_idx" ON "User"("externalId");
CREATE UNIQUE INDEX "User_syncSourceId_externalId_key" ON "User"("syncSourceId", "externalId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


UPDATE "User" SET "locale" = 'auto' WHERE "locale" = 'en';
