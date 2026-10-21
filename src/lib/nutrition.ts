/* ---------------------------------------------------------------------------
   Nutritional status classification, WHO 2007 growth reference, 5 to 19 years.

   This is the real engine. It replaces the earlier stub, which derived a
   z-score from a single fixed mean and standard deviation
   (`(bmi - 16.6) / 1.85`) for every child regardless of age or sex. That
   approximation was fine for rendering a UI shell on generated data and is
   dangerous on real learners: it judges a nine-year-old and a fifteen-year-old
   against the same yardstick.

   The L, M, S parameters live in `src/data/who2007.json` as DATA, extracted
   from WHO's own published expanded tables by `scripts/extract-who.mjs`. That
   script reconstructs WHO's published SD columns from the parameters it parsed
   and refuses to emit if any value disagrees by more than 0.005; the committed
   file passed with 4704 values checked and a largest deviation of 0.0005,
   which is WHO's own rounding. Re-run the script to refresh the tables.

   Still outstanding: a comparison against the printed DepEd SF8 reference
   tables. WHO agreeing with itself proves the parse and the arithmetic, not
   that DepEd bands the same way at the boundaries.

   This module stays pure, with no React and no database imports, so it can be
   tested directly.
--------------------------------------------------------------------------- */

import TABLES from '../data/who2007.json'

export type BmiBand = 'Severely Wasted' | 'Wasted' | 'Normal' | 'Overweight' | 'Obese'
export type HfaBand = 'Severely Stunted' | 'Stunted' | 'Normal' | 'Tall'
export type Sex = 'M' | 'F'

/** BMI-for-age cut-offs, in z-scores, as the SF8 workbook itself bands them.

    NOTE, because this is the one place CHAS knowingly departs from the WHO
    5-19 convention it otherwise implements. WHO 2007 for school-age children
    puts overweight above +1 SD and obesity above +2 SD. The DepEd SF8
    workbook in use at the school does not: its own per-month tables run
    Normal from -2 to +2 SD, Overweight from +2 to +3, Obese at +3 and above.
    That was read directly out of the file's 'BMI Tables' sheet and checked
    against our own LMS values at every age - at 61 months its "Normal to" is
    18.3 where our +2 SD is 18.26, and its "Overweight to" is 20.2 where our
    +3 SD is 20.17 - so the difference is in the banding, not in the numbers.

    CHAS follows the form, so that what a nurse reads on screen is what the
    SF8 she submits will say. Height-for-age needed no change: the workbook's
    height tables agree with ours to the last decimal.

    If DepEd issues cut-offs that say otherwise, this array is the only place
    that has to change. */
export const BMI_CUTOFFS: { band: BmiBand; min: number; max: number }[] = [
  { band: 'Severely Wasted', min: -Infinity, max: -3 },
  { band: 'Wasted', min: -3, max: -2 },
  { band: 'Normal', min: -2, max: 2 },
  { band: 'Overweight', min: 2, max: 3 },
  { band: 'Obese', min: 3, max: Infinity },
]

/** Height-for-age cut-offs, in z-scores. These match the SF8 workbook's own
    height tables exactly, both sexes, every age. */
export const HFA_CUTOFFS: { band: HfaBand; min: number; max: number }[] = [
  { band: 'Severely Stunted', min: -Infinity, max: -3 },
  { band: 'Stunted', min: -3, max: -2 },
  { band: 'Normal', min: -2, max: 2 },
  { band: 'Tall', min: 2, max: Infinity },
]

export const BMI_BANDS: BmiBand[] = [
  'Severely Wasted',
  'Wasted',
  'Normal',
  'Overweight',
  'Obese',
]

export const HFA_BANDS: HfaBand[] = ['Severely Stunted', 'Stunted', 'Normal', 'Tall']

/** Token name for each band. Undernutrition warm, normal green, over cool. */
export const BAND_COLOR: Record<BmiBand | HfaBand, string> = {
  'Severely Wasted': 'var(--color-sw)',
  Wasted: 'var(--color-w)',
  Normal: 'var(--color-n)',
  Overweight: 'var(--color-ow)',
  Obese: 'var(--color-ob)',
  'Severely Stunted': 'var(--color-sw)',
  Stunted: 'var(--color-w)',
  Tall: 'var(--color-tall)',
}

/** Bands that trigger a parent advisory slip under the school's policy. */
export const FLAGGED_BANDS = new Set<string>([
  'Severely Wasted',
  'Wasted',
  'Overweight',
  'Obese',
  'Severely Stunted',
  'Stunted',
])

/* Half-open at the BOTTOM, closed at the top: (min, max].

   The SF8 asks "is the measurement greater than the lower band's ceiling?",
   so a value sitting exactly on a cut-off belongs to the band BELOW it - a z
   of exactly -3 is Severely Wasted, not Wasted. We had it the other way
   round. It decides nothing on a real measurement, where z lands on an
   integer about never, but the form and the app should not be able to
   disagree even in principle. */
export function bandFromZ<T extends { band: string; min: number; max: number }>(
  table: T[],
  z: number,
): T['band'] {
  const hit = table.find((row) => z > row.min && z <= row.max)
  return (hit ?? table[table.length - 1]).band
}

export function classifyBmiForAge(z: number): BmiBand {
  return bandFromZ(BMI_CUTOFFS, z) as BmiBand
}

export function classifyHeightForAge(z: number): HfaBand {
  return bandFromZ(HFA_CUTOFFS, z) as HfaBand
}

export function bmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100
  return weightKg / (m * m)
}

/** Completed months at the date of weighing. This is DepEd's rule, and it is
    where most manual SF8 errors come from. */
export function ageInMonths(birthDate: string, asOf: string): number {
  const b = new Date(birthDate)
  const d = new Date(asOf)
  let months = (d.getFullYear() - b.getFullYear()) * 12 + (d.getMonth() - b.getMonth())
  if (d.getDate() < b.getDate()) months -= 1
  return months
}

export function formatAge(months: number): string {
  return `${Math.floor(months / 12)}y ${months % 12}m`
}

/* --- The reference tables ------------------------------------------------ */

type LmsRow = [month: number, L: number, M: number, S: number]

const LMS: Record<'bfa' | 'hfa', Record<Sex, LmsRow[]>> = {
  bfa: { M: TABLES.bfa.M as LmsRow[], F: TABLES.bfa.F as LmsRow[] },
  hfa: { M: TABLES.hfa.M as LmsRow[], F: TABLES.hfa.F as LmsRow[] },
}

/** The reference covers 61 to 228 completed months, which is 5y1m to 19y0m. */
export const MIN_AGE_MONTHS = 61
export const MAX_AGE_MONTHS = 228

export const WHO_SOURCE = TABLES.source
export const WHO_RETRIEVED = TABLES.retrieved

function lookup(indicator: 'bfa' | 'hfa', sex: Sex, months: number): LmsRow | null {
  if (!Number.isFinite(months)) return null
  const m = Math.floor(months)
  if (m < MIN_AGE_MONTHS || m > MAX_AGE_MONTHS) return null
  const table = LMS[indicator][sex]
  // Rows are one per completed month starting at MIN_AGE_MONTHS, so the index
  // is direct. Guarded, in case a refreshed table is ever sparse.
  const direct = table[m - MIN_AGE_MONTHS]
  if (direct && direct[0] === m) return direct
  return table.find((r) => r[0] === m) ?? null
}

/** Measurement value at a given z, from L, M and S. */
function valueAtZ(L: number, M: number, S: number, z: number): number {
  return L === 0 ? M * Math.exp(S * z) : M * Math.pow(1 + L * S * z, 1 / L)
}

function rawZ(L: number, M: number, S: number, y: number): number {
  return L === 0 ? Math.log(y / M) / S : (Math.pow(y / M, L) - 1) / (L * S)
}

/* WHO's restricted application of the LMS method, for weight-based indicators
   only. Outside +/-3 SD the Box-Cox tail is not supported by the empirical
   data, so WHO extrapolates linearly using the width of the 2-to-3 SD band
   instead. Without this a very thin child gets a z of, say, -6.8 where WHO
   would report -4.1, and the two disagree about nothing that matters here
   (both are Severely Wasted) until you print the number on a slip or compare
   it against an SF8 table cell. Implemented per WHO's published
   "computation of centiles and z-scores" note.

   Height-for-age is not weight-based and takes the plain LMS everywhere. */
function restrictedZ(L: number, M: number, S: number, y: number): number {
  const z = rawZ(L, M, S, y)
  if (z > 3) {
    const sd3 = valueAtZ(L, M, S, 3)
    const sd2 = valueAtZ(L, M, S, 2)
    return 3 + (y - sd3) / (sd3 - sd2)
  }
  if (z < -3) {
    const sd3neg = valueAtZ(L, M, S, -3)
    const sd2neg = valueAtZ(L, M, S, -2)
    return -3 + (y - sd3neg) / (sd2neg - sd3neg)
  }
  return z
}

/** BMI-for-age z. Returns null when the learner is outside the 5-19 reference
    or the measurement is not usable. */
export function zBmiForAge(
  weightKg: number,
  heightCm: number,
  ageMonths: number,
  sex: Sex,
): number | null {
  if (!(weightKg > 0) || !(heightCm > 0)) return null
  const row = lookup('bfa', sex, ageMonths)
  if (!row) return null
  const [, L, M, S] = row
  return restrictedZ(L, M, S, bmi(weightKg, heightCm))
}

/** Height-for-age z. Null when outside the reference or unusable. */
export function zHeightForAge(
  heightCm: number,
  ageMonths: number,
  sex: Sex,
): number | null {
  if (!(heightCm > 0)) return null
  const row = lookup('hfa', sex, ageMonths)
  if (!row) return null
  const [, L, M, S] = row
  return rawZ(L, M, S, heightCm)
}

/* --- Inverses -------------------------------------------------------------

   The measurement that sits exactly on a given z. Needed to build a sample
   roster whose heights and weights are physically consistent with the bands
   shown against them, instead of drawn independently and then labelled. */

/** Height in cm at a given height-for-age z. Null outside the reference. */
export function heightForAgeAtZ(z: number, ageMonths: number, sex: Sex): number | null {
  const row = lookup('hfa', sex, ageMonths)
  if (!row) return null
  const [, L, M, S] = row
  return valueAtZ(L, M, S, z)
}

/** BMI at a given BMI-for-age z, honouring WHO's restricted tail. Null
    outside the reference. */
export function bmiForAgeAtZ(z: number, ageMonths: number, sex: Sex): number | null {
  const row = lookup('bfa', sex, ageMonths)
  if (!row) return null
  const [, L, M, S] = row
  if (z > 3) {
    const sd3 = valueAtZ(L, M, S, 3)
    return sd3 + (z - 3) * (sd3 - valueAtZ(L, M, S, 2))
  }
  if (z < -3) {
    const sd3neg = valueAtZ(L, M, S, -3)
    return sd3neg + (z + 3) * (valueAtZ(L, M, S, -2) - sd3neg)
  }
  return valueAtZ(L, M, S, z)
}

/** Everything the screens need for one measurement, in one call. */
export interface Assessment {
  bmi: number
  bmiZ: number | null
  hfaZ: number | null
  bmiBand: BmiBand | null
  hfaBand: HfaBand | null
  ageMonths: number
  /** True when the learner falls outside the 5-19 reference, so the bands
      cannot be computed and must not be invented. */
  outOfRange: boolean
}

export function assess(
  weightKg: number,
  heightCm: number,
  birthDate: string,
  weighedOn: string,
  sex: Sex,
): Assessment {
  const ageMonths = ageInMonths(birthDate, weighedOn)
  const bmiZ = zBmiForAge(weightKg, heightCm, ageMonths, sex)
  const hfaZ = zHeightForAge(heightCm, ageMonths, sex)
  return {
    bmi: bmi(weightKg, heightCm),
    bmiZ,
    hfaZ,
    bmiBand: bmiZ === null ? null : classifyBmiForAge(bmiZ),
    hfaBand: hfaZ === null ? null : classifyHeightForAge(hfaZ),
    ageMonths,
    outOfRange: ageMonths < MIN_AGE_MONTHS || ageMonths > MAX_AGE_MONTHS,
  }
}
