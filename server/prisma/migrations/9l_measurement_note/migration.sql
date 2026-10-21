-- A short note on one weigh-in, written by the nurse (2026-10-21): the
-- context a figure needs, such as "Recovering from dengue, weight loss
-- expected". Optional; existing measurements have none. The WHO
-- classification is not changed by it - it is read beside the figures.

-- AlterTable
ALTER TABLE "measurements" ADD COLUMN "note" VARCHAR(300);
