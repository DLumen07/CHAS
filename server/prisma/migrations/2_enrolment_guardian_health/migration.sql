-- CreateEnum
CREATE TYPE "EnrolmentStatus" AS ENUM ('ENROLLED', 'TRANSFERRED_IN', 'RETURNING', 'TRANSFERRED_OUT', 'DROPPED');

-- CreateEnum
CREATE TYPE "Relationship" AS ENUM ('MOTHER', 'FATHER', 'GRANDPARENT', 'SIBLING', 'GUARDIAN', 'OTHER');

-- CreateEnum
CREATE TYPE "ContactPreference" AS ENUM ('SMS', 'PRINTED', 'BOTH');

-- CreateEnum
CREATE TYPE "ConditionStatus" AS ENUM ('ACTIVE', 'RESOLVED', 'RECURRING', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DoseStatus" AS ENUM ('GIVEN', 'SCHEDULED', 'MISSED', 'UNKNOWN');

-- AlterTable
ALTER TABLE "learners" ADD COLUMN     "healthNotes" TEXT,
ADD COLUMN     "nameExt" TEXT;

-- CreateTable
CREATE TABLE "enrolments" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "schoolYear" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "adviserId" TEXT,
    "status" "EnrolmentStatus" NOT NULL DEFAULT 'ENROLLED',
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enrolments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardians" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" "Relationship" NOT NULL,
    "primaryMobile" TEXT NOT NULL,
    "secondaryContact" TEXT,
    "contactPreference" "ContactPreference" NOT NULL DEFAULT 'BOTH',
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_conditions" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "status" "ConditionStatus" NOT NULL DEFAULT 'UNKNOWN',
    "treatment" TEXT,
    "notes" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vaccine_doses" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "vaccine" TEXT NOT NULL,
    "dose" TEXT NOT NULL,
    "givenOn" DATE,
    "status" "DoseStatus" NOT NULL DEFAULT 'GIVEN',
    "remarks" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vaccine_doses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "enrolments_sectionId_schoolYear_idx" ON "enrolments"("sectionId", "schoolYear");

-- CreateIndex
CREATE UNIQUE INDEX "enrolments_learnerId_schoolYear_key" ON "enrolments"("learnerId", "schoolYear");

-- CreateIndex
CREATE INDEX "guardians_learnerId_idx" ON "guardians"("learnerId");

-- CreateIndex
CREATE INDEX "health_conditions_learnerId_idx" ON "health_conditions"("learnerId");

-- CreateIndex
CREATE INDEX "vaccine_doses_learnerId_givenOn_idx" ON "vaccine_doses"("learnerId", "givenOn" DESC);

-- AddForeignKey
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "learners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_adviserId_fkey" FOREIGN KEY ("adviserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "learners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_conditions" ADD CONSTRAINT "health_conditions_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "learners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_conditions" ADD CONSTRAINT "health_conditions_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccine_doses" ADD CONSTRAINT "vaccine_doses_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "learners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccine_doses" ADD CONSTRAINT "vaccine_doses_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

