-- A password set by somebody other than the account holder - the published
-- first-launch defaults, or the head creating or resetting an account - must
-- be replaced at the next sign-in. Existing accounts start false; on the
-- desktop build, any account still opening with a published default
-- password is flagged by server/desktop.ts right after this migration runs.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
