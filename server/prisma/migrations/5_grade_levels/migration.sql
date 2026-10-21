-- Grade levels become rows.
--
-- `sections.gradeLevel` was an integer on the section, which works while a
-- school runs one section per year and the section IS the grade. It cannot
-- express a grade that has no sections yet, and it has no row for "Grade 1"
-- to hang two sections off. Both are needed the moment the head lays the
-- school out year by year and then fills each year in.
--
-- Nothing is lost here. Every distinct integer that exists becomes a grade
-- level row, every section is attached to the one it already claimed, and
-- only then is the old column dropped. A section with no matching grade
-- cannot occur, because the grades are built FROM the sections.

-- 1. The new table.
CREATE TABLE "grade_levels" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grade_levels_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "grade_levels_schoolId_level_key" ON "grade_levels"("schoolId", "level");
CREATE UNIQUE INDEX "grade_levels_schoolId_name_key" ON "grade_levels"("schoolId", "name");
CREATE INDEX "grade_levels_schoolId_level_idx" ON "grade_levels"("schoolId", "level");

ALTER TABLE "grade_levels" ADD CONSTRAINT "grade_levels_schoolId_fkey"
    FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. One row per year each school already has a section in. Named the way the
--    integer was always read aloud; the head renames it from Academic setup.
INSERT INTO "grade_levels" ("id", "schoolId", "name", "level")
SELECT gen_random_uuid()::text, s."schoolId", 'Grade ' || s."gradeLevel", s."gradeLevel"
FROM (SELECT DISTINCT "schoolId", "gradeLevel" FROM "sections") s;

-- 3. Attach every section to its grade, then make the column required. The
--    NOT NULL is deliberately set AFTER the backfill: doing it first would
--    fail on the first existing row.
ALTER TABLE "sections" ADD COLUMN "gradeLevelId" TEXT;

UPDATE "sections" s
SET "gradeLevelId" = g."id"
FROM "grade_levels" g
WHERE g."schoolId" = s."schoolId" AND g."level" = s."gradeLevel";

ALTER TABLE "sections" ALTER COLUMN "gradeLevelId" SET NOT NULL;

CREATE INDEX "sections_gradeLevelId_idx" ON "sections"("gradeLevelId");

ALTER TABLE "sections" ADD CONSTRAINT "sections_gradeLevelId_fkey"
    FOREIGN KEY ("gradeLevelId") REFERENCES "grade_levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. The integer has no second reader left.
ALTER TABLE "sections" DROP COLUMN "gradeLevel";
