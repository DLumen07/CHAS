-- Moving the school to a new school year.
--
-- 1. An enrolment records how the year ended (promoted, retained, ...).
-- 2. A section carries its adviser's name, which the SF8 prints and which
--    changes from one year to the next.
-- 3. A slip belongs to one school year, so a new year starts every learner
--    with no invitation while last year's stay on file.
-- 4. Each rollover is logged, so the head can undo it.

CREATE TYPE "EnrolmentOutcome" AS ENUM ('PROMOTED', 'RETAINED', 'COMPLETED', 'TRANSFERRED_OUT', 'DROPPED');

ALTER TABLE "enrolments" ADD COLUMN "outcome" "EnrolmentOutcome";

ALTER TABLE "sections" ADD COLUMN "adviser" TEXT;

-- The advisers the app had written into its source until now, so an existing
-- install keeps printing the same names on its SF8.
UPDATE "sections" SET "adviser" = CASE "name"
    WHEN 'Grade 1' THEN 'Mrs. R. Villanueva'
    WHEN 'Grade 2' THEN 'Mr. J. Bautista'
    WHEN 'Grade 3' THEN 'Mrs. C. Delos Reyes'
    WHEN 'Grade 4' THEN 'Ms. A. Pascual'
    WHEN 'Grade 5' THEN 'Mr. E. Manalo'
    WHEN 'Grade 6' THEN 'Mrs. L. Sarmiento'
END
WHERE "adviser" IS NULL;

-- Every slip on file belongs to the year the school is in now.
ALTER TABLE "slips" ADD COLUMN "schoolYear" TEXT;
UPDATE "slips" s
SET "schoolYear" = sc."schoolYear"
FROM "learners" l
JOIN "schools" sc ON sc."id" = l."schoolId"
WHERE l."id" = s."learnerId";
ALTER TABLE "slips" ALTER COLUMN "schoolYear" SET NOT NULL;

DROP INDEX "slips_learnerId_key";
CREATE UNIQUE INDEX "slips_learnerId_schoolYear_key" ON "slips"("learnerId", "schoolYear");

CREATE TABLE "school_year_rollovers" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "fromYear" TEXT NOT NULL,
    "toYear" TEXT NOT NULL,
    "advisersBefore" JSONB NOT NULL,
    "meetingId" TEXT,
    "rolledById" TEXT NOT NULL,
    "rolledAt" TIMESTAMP(3) NOT NULL,
    "undoneAt" TIMESTAMP(3),

    CONSTRAINT "school_year_rollovers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "school_year_rollovers_schoolId_rolledAt_idx" ON "school_year_rollovers"("schoolId", "rolledAt" DESC);

ALTER TABLE "school_year_rollovers" ADD CONSTRAINT "school_year_rollovers_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "school_year_rollovers" ADD CONSTRAINT "school_year_rollovers_rolledById_fkey" FOREIGN KEY ("rolledById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
