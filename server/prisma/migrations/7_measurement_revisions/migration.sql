-- CreateEnum
CREATE TYPE "MeasurementRevisionKind" AS ENUM ('RECORDED', 'CORRECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "measurement_revisions" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "measuredOn" DATE NOT NULL,
    "heightCm" DECIMAL(4,1),
    "weightKg" DECIMAL(4,1),
    "kind" "MeasurementRevisionKind" NOT NULL,
    "recordedById" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "measurement_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "measurement_revisions_learnerId_at_idx" ON "measurement_revisions"("learnerId", "at" DESC);

-- AddForeignKey
ALTER TABLE "measurement_revisions" ADD CONSTRAINT "measurement_revisions_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "learners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_revisions" ADD CONSTRAINT "measurement_revisions_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

