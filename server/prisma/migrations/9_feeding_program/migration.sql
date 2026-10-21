-- The feeding program: a program, the learners taken onto it, and one row per
-- child per serving day.

-- CreateTable
CREATE TABLE "feeding_programs" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feeding_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feeding_beneficiaries" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "reason" TEXT,
    "enrolledById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feeding_beneficiaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feeding_servings" (
    "id" TEXT NOT NULL,
    "beneficiaryId" TEXT NOT NULL,
    "servedOn" DATE NOT NULL,
    "present" BOOLEAN NOT NULL DEFAULT true,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feeding_servings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feeding_programs_schoolId_startsOn_idx" ON "feeding_programs"("schoolId", "startsOn" DESC);
CREATE UNIQUE INDEX "feeding_programs_schoolId_name_key" ON "feeding_programs"("schoolId", "name");
CREATE INDEX "feeding_beneficiaries_programId_idx" ON "feeding_beneficiaries"("programId");
CREATE INDEX "feeding_beneficiaries_learnerId_idx" ON "feeding_beneficiaries"("learnerId");
CREATE UNIQUE INDEX "feeding_beneficiaries_programId_learnerId_key" ON "feeding_beneficiaries"("programId", "learnerId");
CREATE INDEX "feeding_servings_servedOn_idx" ON "feeding_servings"("servedOn");
CREATE UNIQUE INDEX "feeding_servings_beneficiaryId_servedOn_key" ON "feeding_servings"("beneficiaryId", "servedOn");

-- AddForeignKey
ALTER TABLE "feeding_programs" ADD CONSTRAINT "feeding_programs_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "feeding_programs" ADD CONSTRAINT "feeding_programs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "feeding_beneficiaries" ADD CONSTRAINT "feeding_beneficiaries_programId_fkey" FOREIGN KEY ("programId") REFERENCES "feeding_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "feeding_beneficiaries" ADD CONSTRAINT "feeding_beneficiaries_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "learners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "feeding_beneficiaries" ADD CONSTRAINT "feeding_beneficiaries_enrolledById_fkey" FOREIGN KEY ("enrolledById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "feeding_servings" ADD CONSTRAINT "feeding_servings_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "feeding_beneficiaries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "feeding_servings" ADD CONSTRAINT "feeding_servings_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
