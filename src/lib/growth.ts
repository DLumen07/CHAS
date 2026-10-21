import { ageInMonths, bmi as bmiOf, zBmiForAge } from './nutrition'
import type { ApiLearnerRecord } from './api'

/* The measurement series, ready to plot.

   Derived here and not on the server, for the same reason the bands are: the
   z-score comes from WHO's LMS tables through lib/nutrition.ts, and a second
   implementation in SQL would be a second thing to keep in step with the
   published tables. The server sends height, weight, a date, a sex and a birth
   date; the arithmetic is the client's, exactly as it is on every other screen.

   Shared by the learner's record and the weigh-in station, which draw the same
   series at two sizes. */

export interface GrowthRow {
  date: string
  height: number | null
  weight: number | null
  bmi: number | null
  z: number | null
  by: string
  /** The nurse's note on this weigh-in; '' when none. */
  note: string
}

/** Oldest first, which is the direction a line is read in. */
export function growthRows(record: ApiLearnerRecord): GrowthRow[] {
  return record.history
    .filter((h) => h.measuredOn)
    .sort((a, b) => (a.measuredOn ?? '').localeCompare(b.measuredOn ?? ''))
    .map((h) => {
      const date = h.measuredOn as string
      const months = record.birthDate ? ageInMonths(record.birthDate, date) : null
      return {
        date,
        height: h.heightCm,
        weight: h.weightKg,
        bmi: h.heightCm && h.weightKg ? Number(bmiOf(h.weightKg, h.heightCm).toFixed(1)) : null,
        z:
          h.heightCm && h.weightKg && months !== null
            ? zBmiForAge(h.weightKg, h.heightCm, months, record.sex)
            : null,
        by: h.by,
        note: h.note ?? '',
      }
    })
}

/** One measure pulled out of the series, in the shape a chart takes. */
export function growthPoints(rows: GrowthRow[], key: 'height' | 'weight' | 'bmi' | 'z') {
  return rows.map((r) => ({ date: r.date, value: r[key] }))
}
