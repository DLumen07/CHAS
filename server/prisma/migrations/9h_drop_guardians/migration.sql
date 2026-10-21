-- Removes parent and guardian contact details.
--
-- DESTRUCTIVE. Every guardian row - name, relationship, mobile number and
-- secondary contact - is dropped here. There is no down migration: the rows
-- are gone, not archived. The app stopped collecting and showing them on
-- 2026-10-15 because nothing used them, and the school chose to delete what
-- was already stored rather than keep personal data held for no purpose.
--
-- Learners, their health history and immunization cards are untouched.

-- DropTable (its index and foreign key go with it)
DROP TABLE IF EXISTS "guardians";

-- DropEnum
DROP TYPE IF EXISTS "Relationship";
DROP TYPE IF EXISTS "ContactPreference";
