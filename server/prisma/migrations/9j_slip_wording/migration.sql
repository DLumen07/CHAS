-- The invitation slip's wording, edited by the head or the nurse on the
-- Slips screen: the title, the letter in Filipino and in English, the
-- closing and the signer's line. Null means the wording shipped with the
-- app, so every existing school prints exactly what it printed before.

-- AlterTable
ALTER TABLE "schools" ADD COLUMN "slipText" JSONB;
