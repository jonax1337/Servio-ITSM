-- Category.portalHidden: staff-only categories (e.g. monitoring) that the self-service portal does not offer.
ALTER TABLE "Category" ADD COLUMN "portalHidden" BOOLEAN NOT NULL DEFAULT false;
