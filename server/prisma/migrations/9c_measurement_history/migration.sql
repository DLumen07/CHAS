-- The school-wide measurement history reads every revision newest first.
CREATE INDEX "measurement_revisions_at_idx" ON "measurement_revisions"("at" DESC);

-- Measurements saved before the revision log existed (or written directly,
-- such as sample data) have no history entry. Give each one a RECORDED entry
-- so the history is complete. A row typed after its measurement date is
-- dated 09:00 Philippine time (01:00 UTC) on that date rather than on the day
-- it was typed in.
INSERT INTO "measurement_revisions" ("id", "learnerId", "measuredOn", "heightCm", "weightKg", "kind", "recordedById", "at")
SELECT
    'bf_' || m."id",
    m."learnerId",
    m."measuredOn",
    m."heightCm",
    m."weightKg",
    'RECORDED',
    m."recordedById",
    CASE
        WHEN m."createdAt"::date > m."measuredOn" THEN m."measuredOn" + TIME '01:00'
        ELSE m."createdAt"
    END
FROM "measurements" m
WHERE NOT EXISTS (
    SELECT 1 FROM "measurement_revisions" r
    WHERE r."learnerId" = m."learnerId" AND r."measuredOn" = m."measuredOn"
);
