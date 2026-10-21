-- AlterTable
ALTER TABLE "absences" ADD COLUMN     "cycleId" TEXT;

-- AlterTable
ALTER TABLE "measurements" ADD COLUMN     "cycleId" TEXT;

-- CreateTable
CREATE TABLE "weigh_in_cycles" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "schoolYear" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "opensOn" DATE NOT NULL,
    "closesOn" DATE NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weigh_in_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "weigh_in_cycles_schoolId_opensOn_idx" ON "weigh_in_cycles"("schoolId", "opensOn" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "weigh_in_cycles_schoolId_schoolYear_ordinal_key" ON "weigh_in_cycles"("schoolId", "schoolYear", "ordinal");

-- CreateIndex
CREATE INDEX "absences_cycleId_idx" ON "absences"("cycleId");

-- CreateIndex
CREATE INDEX "measurements_cycleId_idx" ON "measurements"("cycleId");

-- AddForeignKey
ALTER TABLE "weigh_in_cycles" ADD CONSTRAINT "weigh_in_cycles_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "weigh_in_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "absences" ADD CONSTRAINT "absences_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "weigh_in_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Backfill: give every weigh-in already on file the round it belongs to.
--
-- A Philippine school year runs June to May, and the school weighs twice. So a
-- session dated June to November is the FIRST weigh-in of the year that opened
-- that June; December to May is the SECOND. That rule is what turns a pile of
-- dates into rounds without anybody retyping them.
--
-- CURRENT_DATE is unioned in per school so that a school with no history still
-- comes out of this migration with the round it is standing in, open. Without
-- it a live database could finish the migration with no open cycle, and the
-- roster would correctly but uselessly report that nobody has been measured.
WITH dated AS (
    SELECT l."schoolId" AS school_id, m."measuredOn" AS d
      FROM "measurements" m JOIN "learners" l ON l.id = m."learnerId"
    UNION ALL
    SELECT l."schoolId", a."measuredOn"
      FROM "absences" a JOIN "learners" l ON l.id = a."learnerId"
    UNION ALL
    SELECT s.id, CURRENT_DATE FROM "schools" s
), rounds AS (
    SELECT DISTINCT
        school_id,
        CASE WHEN EXTRACT(MONTH FROM d) >= 6
             THEN EXTRACT(YEAR FROM d)::int
             ELSE EXTRACT(YEAR FROM d)::int - 1 END AS sy,
        CASE WHEN EXTRACT(MONTH FROM d) BETWEEN 6 AND 11 THEN 1 ELSE 2 END AS ordinal
      FROM dated
)
INSERT INTO "weigh_in_cycles" (
    "id", "schoolId", "schoolYear", "ordinal", "opensOn", "closesOn", "closedAt",
    "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid()::text,
    school_id,
    sy || '-' || (sy + 1),
    ordinal,
    CASE WHEN ordinal = 1 THEN make_date(sy, 6, 1) ELSE make_date(sy, 12, 1) END,
    CASE WHEN ordinal = 1 THEN make_date(sy, 11, 30) ELSE make_date(sy + 1, 5, 31) END,
    NULL,
    now(), now()
  FROM rounds
ON CONFLICT DO NOTHING;

-- Exactly one round stays open: the one today falls inside. Closing is a
-- timestamp, not a delete - last year's rows keep their round and the SF8 for
-- it keeps printing.
UPDATE "weigh_in_cycles"
   SET "closedAt" = ("closesOn" + time '23:59:59')
 WHERE NOT (CURRENT_DATE BETWEEN "opensOn" AND "closesOn");

UPDATE "measurements" m
   SET "cycleId" = c.id
  FROM "learners" l, "weigh_in_cycles" c
 WHERE l.id = m."learnerId"
   AND c."schoolId" = l."schoolId"
   AND m."measuredOn" BETWEEN c."opensOn" AND c."closesOn";

UPDATE "absences" a
   SET "cycleId" = c.id
  FROM "learners" l, "weigh_in_cycles" c
 WHERE l.id = a."learnerId"
   AND c."schoolId" = l."schoolId"
   AND a."measuredOn" BETWEEN c."opensOn" AND c."closesOn";
