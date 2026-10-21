/* Mock roster for the UI shell. Replaced wholesale by the SQLite layer.
   Names are fabricated; no real learner data belongs in source control. */

import {
  type BmiBand,
  type HfaBand,
  ageInMonths,
  assess,
  bmiForAgeAtZ,
  heightForAgeAtZ,
} from '../lib/nutrition'

/* The three states a slip passes through, and they are three different
   facts: nothing sent, an invitation handed out, and a parent who actually
   came. 'attended' replaced 'returned' when the slip stopped being an
   advisory to acknowledge and became an invitation to a meeting - a stub
   that comes back says the letter arrived, which is not the same as anyone
   turning up, and the school needs the second fact. */
export type SlipState = 'not-printed' | 'printed' | 'attended'

/* Whether the learner's immunization card is complete, as the school health
   record wants it.

   Three values rather than a boolean, because "no card on file" and "card
   seen, doses missing" are different facts and the school chases them
   differently - the first is a records problem, the second is a health one.
   A boolean would collapse the two, and the admin screen could then not tell
   an unvaccinated child from an unfiled one. */
export type ImmunizationStatus = 'complete' | 'incomplete' | 'none'

export const IMMUNIZATION_LABEL: Record<ImmunizationStatus, string> = {
  complete: 'Up to date',
  incomplete: 'Incomplete',
  none: 'No record on file',
}

export const IMMUNIZATION_STATUSES: ImmunizationStatus[] = ['complete', 'incomplete', 'none']

export interface Learner {
  id: string
  lrn: string
  lastName: string
  firstName: string
  middleName: string
  sex: 'M' | 'F'
  birthDate: string
  section: string
  gradeLevel: number
  /** The year level as the school names it: "Grade 4". */
  gradeName?: string
  heightCm: number | null
  weightKg: number | null
  measuredOn: string | null
  /** The nurse's note on the newest weigh-in this school year; '' or absent when none. */
  measurementNote?: string
  bmiZ: number | null
  hfaZ: number | null
  bmiBand: BmiBand | null
  hfaBand: HfaBand | null
  slip: SlipState
  printedAt: string | null
  attendedAt: string | null
  /** The meeting this learner's slip invited the parent to, frozen at print
      time. Null before a slip is printed, or where the store never kept it. */
  slipMeeting?: { date: string; time: string; venue: string } | null
  stubId: string
  /** Immunization card status. Part of the same school health record as the
      measurements, and the one figure on it that does not come off a scale. */
  immunization: ImmunizationStatus
  /** The newest measurement from an EARLIER school year, when this year has
      none yet. For comparison on the weigh-in screen only: it is not this
      year's status, so nothing counts or reports it. */
  previous?: { heightCm: number; weightKg: number; measuredOn: string } | null
}

/* Detailen runs one section per year level, so a "section" here IS the grade
   level and is named as one. Name and grade stay separate fields anyway: a
   school that later opens a second section per grade adds rows here, and no
   screen that groups by `section` has to change. */
export const SECTIONS = [
  { name: 'Grade 1', grade: 1, adviser: 'Mrs. R. Villanueva' },
  { name: 'Grade 2', grade: 2, adviser: 'Mr. J. Bautista' },
  { name: 'Grade 3', grade: 3, adviser: 'Mrs. C. Delos Reyes' },
  { name: 'Grade 4', grade: 4, adviser: 'Ms. A. Pascual' },
  { name: 'Grade 5', grade: 5, adviser: 'Mr. E. Manalo' },
  { name: 'Grade 6', grade: 6, adviser: 'Mrs. L. Sarmiento' },
]

const LAST = [
  'Dela Cruz', 'Santos', 'Reyes', 'Ramos', 'Mercado', 'Aquino', 'Bautista',
  'Garcia', 'Villanueva', 'Torres', 'Domingo', 'Castillo', 'Navarro', 'Padilla',
  'Salazar', 'Bernardo', 'Gutierrez', 'Rivera', 'Alvarez', 'Marasigan',
]
const MALE = ['Juan', 'Miguel', 'Rafael', 'Andres', 'Lorenzo', 'Gabriel', 'Emilio', 'Nathaniel']
const FEMALE = ['Maria', 'Andrea', 'Sofia', 'Clarisse', 'Bea', 'Angelica', 'Kyla', 'Trisha']
const MIDDLE = ['Perez', 'Lim', 'Cruz', 'Ocampo', 'Fajardo', 'Serrano', 'Yap', 'Diaz']

/** Deterministic PRNG so the shell renders identically on every reload. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function pick<T>(r: () => number, arr: T[]): T {
  return arr[Math.floor(r() * arr.length)]
}

/** Box-Muller. Z-scores are generated from a distribution rather than derived
    from invented heights and weights - otherwise the bands come out nothing
    like a real school roster and the dashboard is meaningless to look at. */
function gauss(r: () => number, mean: number, sd: number): number {
  const u = Math.max(r(), 1e-9)
  const v = r()
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/* Today, on this computer's clock, as an ISO day.

   This was a fixed demo date (2026-08-10), and every screen that saves uses
   it: a weigh-in recorded in October was dated August, a learner's age - and
   with it the WHO z-score and the band - was computed for August, and a
   parent's attendance was stamped on a day before the meeting. It is the real
   date now. Read once when the app opens; CHAS is opened each school day. */
export const TODAY = (() => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
})()

/* The meeting the sample roster's printed slips (2026-08-06) invited parents
   to - the attendance dates below fall on it. */
const SAMPLE_MEETING = { date: '2026-08-08', time: '9:00 - 11:00 ng umaga', venue: 'Silid-aklatan, Detailen Elem. School' }

function build(): Learner[] {
  const r = rng(20260810)
  const out: Learner[] = []
  let n = 0

  for (const section of SECTIONS) {
    const count = 26 + Math.floor(r() * 8)

    /* Every learner in a section must be distinguishable by the name the
       screens actually print.

       They were not. The pools are twenty surnames and eight given names per
       sex, so a class of thirty draws collisions the way a room of thirty
       draws shared birthdays - and every list in this app shows "Last, First"
       while only the record dialog shows the middle initial. The result was
       two rows reading "Marasigan, Kyla" in one class, which is not a
       plausible roster; it is a bug that looks like one.

       Rejection sampling on the displayed pair. 160 combinations per sex
       against a class of at most 33, so this terminates in a couple of draws;
       the cap is there so a future pool that is too small degrades into
       duplicates rather than hanging the module. */
    const usedNames = new Set<string>()

    for (let i = 0; i < count; i++) {
      const sex: 'M' | 'F' = r() > 0.5 ? 'M' : 'F'

      let lastName = pick(r, LAST)
      let firstName = sex === 'M' ? pick(r, MALE) : pick(r, FEMALE)
      for (let tries = 0; tries < 40 && usedNames.has(`${lastName}|${firstName}`); tries++) {
        lastName = pick(r, LAST)
        firstName = sex === 'M' ? pick(r, MALE) : pick(r, FEMALE)
      }
      usedNames.add(`${lastName}|${firstName}`)
      const ageYears = section.grade + 5 + (r() > 0.75 ? 1 : 0)
      const birthYear = 2026 - ageYears
      const birthDate = `${birthYear}-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(
        1 + Math.floor(r() * 27),
      ).padStart(2, '0')}`

      // ~78% of the roster has been weighed in this window.
      const measured = r() < 0.78

      // Draw the z-scores first, then back-solve the measurements that agree
      // with them. Centres roughly match Philippine school-age prevalence: a
      // mild undernutrition skew and a real stunting tail.
      const bmiZ = measured
        ? Math.round(Math.max(-4.5, Math.min(4.5, gauss(r, -0.2, 1.1))) * 100) / 100
        : null
      const hfaZ = measured
        ? Math.round(Math.max(-4.5, Math.min(4.5, gauss(r, -0.6, 1.0))) * 100) / 100
        : null

      /* Height and weight are inverted out of the REAL WHO tables for this
         learner's own age in months and sex, so the roster is physically
         consistent: a learner shown as Stunted really is short for their age,
         and re-measuring them in the weigh-in screen reproduces the same
         band. The old version back-solved from a single fixed mean and SD,
         which produced 160cm nine-year-olds labelled Stunted. */
      const measuredOn = measured ? '2026-08-04' : null
      const ageM = measuredOn ? ageInMonths(birthDate, measuredOn) : null

      const heightCm =
        measured && hfaZ !== null && ageM !== null
          ? Math.round((heightForAgeAtZ(hfaZ, ageM, sex) ?? 0) * 10) / 10
          : null

      const weightKg =
        measured && heightCm && bmiZ !== null && ageM !== null
          ? Math.round((bmiForAgeAtZ(bmiZ, ageM, sex) ?? 0) * (heightCm / 100) ** 2 * 10) / 10
          : null

      /* Classify from the rounded measurements the screens actually display,
         not from the z that was drawn. Rounding height to 0.1cm moves the
         z slightly, and the roster must agree with what re-computing from the
         visible numbers would give. */
      const a =
        measured && heightCm && weightKg && measuredOn
          ? assess(weightKg, heightCm, birthDate, measuredOn, sex)
          : null

      const bmiBand = a?.bmiBand ?? null
      const hfaBand = a?.hfaBand ?? null

      const flagged =
        (bmiBand !== null && bmiBand !== 'Normal') || (hfaBand !== null && hfaBand !== 'Normal')

      let slip: SlipState = 'not-printed'
      let printedAt: string | null = null
      let attendedAt: string | null = null
      if (flagged && measured) {
        const p = r()
        if (p < 0.72) {
          slip = 'printed'
          printedAt = '2026-08-06'
          if (r() < 0.58) {
            slip = 'attended'
            attendedAt = '2026-08-08'
          }
        }
      }

      /* Drawn from the same seeded stream as everything else, so the roster
         is identical on every reload. The mix is roughly what a rural
         Philippine elementary school reports: most cards complete, a real
         incomplete tail, and a handful of learners whose card has never
         reached the school at all. */
      const im = r()
      const immunization: ImmunizationStatus =
        im < 0.74 ? 'complete' : im < 0.92 ? 'incomplete' : 'none'

      n++
      out.push({
        id: `L${String(n).padStart(4, '0')}`,
        lrn: `1360${String(210000 + n * 37).padStart(8, '0')}`,
        lastName,
        firstName,
        middleName: pick(r, MIDDLE),
        sex,
        birthDate,
        section: section.name,
        gradeLevel: section.grade,
        gradeName: `Grade ${section.grade}`,
        heightCm,
        weightKg,
        measuredOn,
        bmiZ: a && a.bmiZ !== null ? Number(a.bmiZ.toFixed(2)) : null,
        hfaZ: a && a.hfaZ !== null ? Number(a.hfaZ.toFixed(2)) : null,
        bmiBand,
        hfaBand,
        slip,
        printedAt,
        attendedAt,
        slipMeeting: printedAt ? SAMPLE_MEETING : null,
        stubId: `G${section.grade}-${String(n).padStart(4, '0')}`,
        immunization,
      })
    }
  }
  return out
}

export const LEARNERS: Learner[] = build()

/** How many learners each section holds.

    The sign-in screen needs this before the install has been claimed - that
    is, before there is a scoped roster to count - so it cannot come from
    useRoster(), which by then is deliberately returning nobody. */
export const SECTION_SIZE: Record<string, number> = LEARNERS.reduce<Record<string, number>>(
  (acc, l) => {
    acc[l.section] = (acc[l.section] ?? 0) + 1
    return acc
  },
  {},
)

/* The one school-wide account.

   CHAS is installed per class adviser, and that is still the shape of the
   thing - six laptops, six sections, six rosters that never see each other.
   The school head's install is the exception the design always implied and
   never had: one machine that reads every section, so the figures DepEd asks
   for at division level can be counted once instead of phoned in six times.

   It is a different ROLE, not a privilege level. The admin install records no
   measurements; it reads. Named here beside the sections because it is the
   same kind of fact - who this software belongs to at this school. */
export const ADMIN = {
  name: 'Mrs. A. Bantolo',
  title: 'School Head',
} as const

/* The other school-wide account, and the reason "school-wide" is not the same
   as "in charge".

   The nurse reads every section for a reason the head's account cannot cover.
   A child whose band comes back wasted is sent to her whatever grade she is
   in, the immunization card is kept at her table rather than in a section's
   folder, and the follow-up that comes out of a weigh-in is hers to close. A
   roster that stopped at a section boundary would mean the one person the
   school sends its sick children to could not read half of them.

   What she is NOT is a second head. She creates no accounts, opens and closes
   no weighing rounds, and does not export the SF8 - those are the head's, and
   the split is enforced in server/src/auth/session.ts rather than described
   here. The name matches the one the audit log has always carried. */
export const NURSE = {
  name: 'Mrs. M. Ocampo',
  title: 'School Nurse',
} as const

export function fullName(l: Learner): string {
  return `${l.lastName}, ${l.firstName} ${l.middleName.charAt(0)}.`
}

export interface AuditEntry {
  id: number
  at: string
  actor: string
  role: string
  action: string
  target: string
  hash: string
}

export const AUDIT: AuditEntry[] = [
  { id: 428, at: '2026-08-10 09:14:22', actor: 'M. Ocampo', role: 'Nurse', action: 'MEASUREMENT_RECORDED', target: 'L0114 - Grade 4', hash: '4f2a…c81b' },
  { id: 427, at: '2026-08-10 09:11:05', actor: 'M. Ocampo', role: 'Nurse', action: 'MEASUREMENT_CORRECTED', target: 'L0112 - height 128.0 → 132.4', hash: '9d10…7ae4' },
  { id: 426, at: '2026-08-10 08:58:47', actor: 'M. Ocampo', role: 'Nurse', action: 'SESSION_OPENED', target: 'Weigh-in - Grade 4', hash: 'a731…20f9' },
  { id: 425, at: '2026-08-08 15:32:10', actor: 'R. Villanueva', role: 'Adviser', action: 'STUB_RETURNED', target: 'G4-0031 - signed by guardian', hash: 'bb47…5c02' },
  { id: 424, at: '2026-08-08 15:30:52', actor: 'R. Villanueva', role: 'Adviser', action: 'STUB_RETURNED', target: 'G4-0029 - signed by guardian', hash: '0e6c…19d7' },
  { id: 423, at: '2026-08-06 11:02:19', actor: 'M. Ocampo', role: 'Nurse', action: 'SLIP_BATCH_PRINTED', target: '38 slips - Grade 4 & 5', hash: '77fa…8b31' },
  { id: 422, at: '2026-08-06 10:47:33', actor: 'A. Bantolo', role: 'Admin', action: 'SF8_EXPORT_RELEASED', target: 'Grade 6 - after nurse review', hash: 'c2d5…f640' },
  { id: 421, at: '2026-08-05 16:20:04', actor: 'A. Bantolo', role: 'Admin', action: 'BACKUP_COMPLETED', target: 'Encrypted → USB (verified)', hash: '31ee…aa78' },
  { id: 420, at: '2026-08-05 08:03:41', actor: 'A. Bantolo', role: 'Admin', action: 'LOGIN_FAILED', target: 'account: nurse (bad passphrase)', hash: '5a90…dd12' },
]

