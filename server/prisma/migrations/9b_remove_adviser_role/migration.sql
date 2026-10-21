-- Named 9b_ so it sorts after 9_feeding_program: Prisma orders migrations by
-- folder name, and "10_" would sort before "1_announcements".

-- The class-adviser account is gone. CHAS now has two posts, the head and the
-- nurse, and both read the whole school.
--
-- EXISTING ADVISER ACCOUNTS ARE NOT DELETED. Every measurement, slip and
-- enrolment an adviser recorded points at that user row with ON DELETE
-- RESTRICT, and the audit trail needs the name behind each one. So they are
-- disabled - which already means "cannot sign in, still referenced" - their
-- sessions are ended now rather than at expiry, and they are moved onto a
-- remaining role because the old value is about to stop existing. Disabled,
-- the role they carry grants nothing.

-- End every live adviser session.
DELETE FROM "sessions"
WHERE "userId" IN (SELECT "id" FROM "users" WHERE "role" = 'ADVISER');

-- Disable the accounts, keeping an earlier disabledAt if there is one.
UPDATE "users"
SET "disabledAt" = COALESCE("disabledAt", CURRENT_TIMESTAMP),
    "role" = 'NURSE'
WHERE "role" = 'ADVISER';

-- The adviser on an enrolment row was a user id. With no adviser accounts it
-- has nothing to point at.
ALTER TABLE "enrolments" DROP CONSTRAINT "enrolments_adviserId_fkey";
ALTER TABLE "enrolments" DROP COLUMN "adviserId";

-- The section an account was scoped to. Every remaining role is school-wide.
ALTER TABLE "users" DROP CONSTRAINT "users_sectionId_fkey";
DROP INDEX "users_sectionId_idx";
ALTER TABLE "users" DROP COLUMN "sectionId";

-- Postgres cannot drop a value from an enum, so the type is rebuilt.
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
CREATE TYPE "Role_new" AS ENUM ('ADMIN', 'NURSE');
ALTER TABLE "users" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
DROP TYPE "Role";
ALTER TYPE "Role_new" RENAME TO "Role";

-- Notices addressed to the class advisers now go to staff.
UPDATE "announcements" SET "audience" = 'STAFF' WHERE "audience" = 'ADVISERS';
ALTER TABLE "announcements" ALTER COLUMN "audience" DROP DEFAULT;
CREATE TYPE "Audience_new" AS ENUM ('STAFF', 'PARENTS');
ALTER TABLE "announcements" ALTER COLUMN "audience" TYPE "Audience_new" USING ("audience"::text::"Audience_new");
DROP TYPE "Audience";
ALTER TYPE "Audience_new" RENAME TO "Audience";
ALTER TABLE "announcements" ALTER COLUMN "audience" SET DEFAULT 'STAFF';
