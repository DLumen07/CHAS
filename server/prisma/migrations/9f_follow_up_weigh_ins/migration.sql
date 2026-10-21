-- A follow-up weigh-in: an extra weigh-in for a chosen set of learners,
-- between the baseline and the endline. Additive only - no existing table or
-- row is changed. Measurements stay plain dated rows; this table only says
-- which learners are expected and from which date.

-- CreateTable
CREATE TABLE "follow_up_weigh_ins" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startedOn" DATE NOT NULL,
    "learnerIds" TEXT[],
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "follow_up_weigh_ins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "follow_up_weigh_ins_schoolId_closedAt_idx" ON "follow_up_weigh_ins"("schoolId", "closedAt");

-- AddForeignKey
ALTER TABLE "follow_up_weigh_ins" ADD CONSTRAINT "follow_up_weigh_ins_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
