-- The school's own logo, uploaded by the head in School settings, so CHAS
-- can be set up for any school rather than carrying one school's seal.
-- Additive only: every existing school keeps the logo shipped with the app
-- until the head uploads another.

-- AlterTable
ALTER TABLE "schools" ADD COLUMN "logo" BYTEA;
ALTER TABLE "schools" ADD COLUMN "logoType" TEXT;
ALTER TABLE "schools" ADD COLUMN "logoUpdatedAt" TIMESTAMP(3);
