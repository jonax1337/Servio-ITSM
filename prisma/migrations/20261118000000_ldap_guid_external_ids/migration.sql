-- Directory (LDAP / Active Directory) sync: objectGUID external ids move from the
-- raw hex of the 16 bytes to the canonical GUID text form, the form directory
-- tools show (first three groups little-endian):
--   c98b91356d19ea409779889d79b753f0  ->  35918bc9-196d-40ea-9779-889d79b753f0
-- Only users of LDAP / ACTIVE_DIRECTORY sources whose external id attribute is a
-- GUID attribute, and only values that are exactly 32 hex digits, are touched.
-- Data only, no schema change; safe to run on a populated database (the mapping
-- is one-to-one, so the (syncSourceId, externalId) unique key cannot collide).
-- The connector also matches the old hex form, so a user this migration did not
-- convert (e.g. a database migrated by other means) is moved on the next sync.
UPDATE "User"
SET "externalId" = lower(
  substr("externalId", 7, 2) || substr("externalId", 5, 2) || substr("externalId", 3, 2) || substr("externalId", 1, 2) || '-' ||
  substr("externalId", 11, 2) || substr("externalId", 9, 2) || '-' ||
  substr("externalId", 15, 2) || substr("externalId", 13, 2) || '-' ||
  substr("externalId", 17, 4) || '-' ||
  substr("externalId", 21, 12)
)
WHERE "externalId" IS NOT NULL
  AND length("externalId") = 32
  AND "externalId" NOT GLOB '*[^0-9A-Fa-f]*'
  AND "syncSourceId" IN (
    SELECT "id" FROM "SyncSource"
    WHERE "type" IN ('LDAP', 'ACTIVE_DIRECTORY')
      AND lower(CASE WHEN json_valid("config") THEN coalesce(json_extract("config", '$.externalId'), '') ELSE '' END) LIKE '%guid%'
  );
