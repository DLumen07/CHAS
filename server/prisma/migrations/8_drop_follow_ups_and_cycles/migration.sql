-- Removes follow-up and monitoring, and the weigh-in round.
--
-- DESTRUCTIVE. Every follow-up, every message and action logged against one,
-- and every weighing round the school opened are dropped here. There is no
-- down migration: the rows are gone, not archived.
--
-- Measurements and absences SURVIVE. They only lose the column that said
-- which round they belonged to; a measurement is still an event with a date,
-- which is what every report actually reads.

-- DropForeignKey
ALTER TABLE "measurements" DROP CONSTRAINT IF EXISTS "measurements_cycleId_fkey";
ALTER TABLE "absences" DROP CONSTRAINT IF EXISTS "absences_cycleId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "measurements_cycleId_idx";
DROP INDEX IF EXISTS "absences_cycleId_idx";

-- AlterTable
ALTER TABLE "measurements" DROP COLUMN IF EXISTS "cycleId";
ALTER TABLE "absences" DROP COLUMN IF EXISTS "cycleId";

-- DropTable
DROP TABLE IF EXISTS "follow_up_messages";
DROP TABLE IF EXISTS "follow_up_actions";
DROP TABLE IF EXISTS "follow_ups";
DROP TABLE IF EXISTS "weigh_in_cycles";

-- DropEnum
DROP TYPE IF EXISTS "FollowUpReason";
DROP TYPE IF EXISTS "FollowUpSource";
DROP TYPE IF EXISTS "FollowUpPriority";
DROP TYPE IF EXISTS "FollowUpStatus";
DROP TYPE IF EXISTS "CommunicationChannel";
DROP TYPE IF EXISTS "CommunicationStatus";
