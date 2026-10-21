-- Follow-up and monitoring: the tables that record what the school DID about
-- what it measured. Generated from the schema; see the section comment in
-- schema.prisma for why OVERDUE is not one of the stored statuses and why
-- messages and actions are append-only.

-- CreateEnum
CREATE TYPE "FollowUpReason" AS ENUM ('NUTRITIONAL_STATUS', 'GROWTH_MONITORING', 'VISION_SCREENING', 'HEARING_SCREENING', 'DENTAL_SCREENING', 'IMMUNIZATION_VERIFICATION', 'HEALTH_HISTORY_REVIEW', 'FEEDING_PROGRAM', 'OTHER');

-- CreateEnum
CREATE TYPE "FollowUpSource" AS ENUM ('ASSESSMENT', 'SCREENING', 'IMMUNIZATION', 'FEEDING_PROGRAM', 'MANUAL');

-- CreateEnum
CREATE TYPE "FollowUpPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('PENDING', 'SCHEDULED', 'NOTIFIED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "CommunicationChannel" AS ENUM ('SMS', 'PRINTED_NOTICE', 'ACKNOWLEDGMENT');

-- CreateEnum
CREATE TYPE "CommunicationStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'PRINTED', 'RETURNED');

-- AlterTable
ALTER TABLE "grade_levels" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "follow_ups" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "reason" "FollowUpReason" NOT NULL,
    "reasonOther" TEXT,
    "source" "FollowUpSource" NOT NULL,
    "sourceLabel" TEXT,
    "sourceOn" DATE,
    "sourceMeasurementId" TEXT,
    "priority" "FollowUpPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "FollowUpStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledOn" DATE,
    "assignedToId" TEXT,
    "createdById" TEXT NOT NULL,
    "notes" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_up_messages" (
    "id" TEXT NOT NULL,
    "followUpId" TEXT NOT NULL,
    "channel" "CommunicationChannel" NOT NULL,
    "status" "CommunicationStatus" NOT NULL,
    "body" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT NOT NULL,

    CONSTRAINT "follow_up_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_up_actions" (
    "id" TEXT NOT NULL,
    "followUpId" TEXT NOT NULL,
    "actedOn" DATE NOT NULL,
    "actionTaken" TEXT NOT NULL,
    "observation" TEXT,
    "outcome" TEXT,
    "nextAction" TEXT,
    "nextFollowUpOn" DATE,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follow_up_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "follow_ups_learnerId_createdAt_idx" ON "follow_ups"("learnerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "follow_ups_schoolId_status_scheduledOn_idx" ON "follow_ups"("schoolId", "status", "scheduledOn");

-- CreateIndex
CREATE UNIQUE INDEX "follow_ups_schoolId_reference_key" ON "follow_ups"("schoolId", "reference");

-- CreateIndex
CREATE INDEX "follow_up_messages_followUpId_at_idx" ON "follow_up_messages"("followUpId", "at");

-- CreateIndex
CREATE INDEX "follow_up_actions_followUpId_actedOn_idx" ON "follow_up_actions"("followUpId", "actedOn" DESC);

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "learners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_messages" ADD CONSTRAINT "follow_up_messages_followUpId_fkey" FOREIGN KEY ("followUpId") REFERENCES "follow_ups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_messages" ADD CONSTRAINT "follow_up_messages_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_actions" ADD CONSTRAINT "follow_up_actions_followUpId_fkey" FOREIGN KEY ("followUpId") REFERENCES "follow_ups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_actions" ADD CONSTRAINT "follow_up_actions_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

