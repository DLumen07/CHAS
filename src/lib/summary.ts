/* The school-wide figures, and the definitions behind them.

   This is arithmetic over a roster, not layout, so it lives here rather than
   in the admin screen - the same reason `filters.ts` is not inside Learners.
   It is also the file to argue with. Every tile on the admin dashboard is one
   line of this module, and a figure a school head reports upward is only as
   good as the sentence that defines it, so each one is written down here
   next to the code that computes it rather than implied by a JSX label.

   The rule the rest of the app keeps applies here too: nothing on this screen
   is a projection, a placeholder or a target. Every number below is a count of
   learners in the roster this install can see. Where a figure CANNOT be
   counted, the count is zero and the screen says why - it is never estimated.
*/

import type { ImmunizationStatus, Learner } from '../data/mock'
import { BMI_BANDS, HFA_BANDS, type BmiBand, type HfaBand, type Sex } from './nutrition'

/* "Flagged" is `filters.isFlagged` - off Normal on either index - imported
   rather than restated. Two definitions of who needs monitoring is how the
   admin screen and the roster end up reporting different counts of the same
   children, and the one that gets believed is whichever was read last. */
import { isFlagged } from './filters'

/** Wasted and Severely Wasted, the two bands below Normal on BMI-for-age.

    NAMING, because this is the one figure on the screen whose common name is
    not its technical one. DepEd and the school both say "underweight"; WHO's
    5-19 reference calls the same thing thinness, and reserves "underweight"
    for a weight-for-age index CHAS does not compute (it is not defined past
    ten years, so it cannot be carried across an elementary roster). The tile
    is labelled the way the school says it and the definition is stated on the
    tile itself, which is better than printing a word the nurse does not use. */
export const UNDERWEIGHT_BANDS: BmiBand[] = ['Severely Wasted', 'Wasted']

export interface SchoolSummary {
  /** Every learner on the roster this install can see. */
  registered: number
  /** Measured, and Normal on BOTH indices. A child who is Normal on BMI and
      Stunted on height is not healthy, and counting them here is the single
      easiest way to make this screen flatter than the truth. */
  healthy: number
  /** Measured, and off Normal on either index. `healthy + needsMonitoring`
      is therefore the measured count, never the registered count - the
      difference between the two is the third state, "not weighed yet", which
      is its own figure below rather than being folded into either. */
  needsMonitoring: number
  /** Card seen, doses complete. Counted against the whole roster, not against
      the measured subset: an immunization card has nothing to do with a
      scale, and scoping it to the weighed children would quietly report a
      better rate than the school actually has. */
  immunized: number
  /** Wasted or Severely Wasted. A subset of needsMonitoring, not an addition
      to it. */
  underweight: number
  /** Weighed in the calendar month of the reference date. */
  assessedThisMonth: number
  /** Flagged, and no parent has yet come to a meeting about it. This is the
      backlog: it is the only figure here that is a piece of work rather than
      a state of a child, and it is the reason the screen exists. */
  pendingFollowups: number
  /** The two halves of that backlog, which are owed by different people: a
      slip nobody has printed is the school's to run off, and a slip already
      in a parent's hand is waiting on the parent. */
  awaitingSlip: number
  awaitingParent: number
  /** Neither measured nor excused. The denominator's missing piece. */
  notYetMeasured: number
  measured: number
  immunization: Record<ImmunizationStatus, number>
}

/** The calendar month a date string belongs to, as `YYYY-MM`. ISO dates sort
    and slice, so no Date object is constructed - parsing `2026-08-04` through
    `new Date` and reading it back in local time is how an off-by-one-month
    bug gets into a report. */
function monthOf(iso: string): string {
  return iso.slice(0, 7)
}

/**
 * Count the roster.
 *
 * `asOf` is the date the school is looking at, and it decides one figure:
 * which month "assessed this month" means. It is passed in rather than read
 * from the clock so the caller says explicitly what "now" is - the sample
 * roster is built around a fixed session date, and a screen that silently
 * counted against the wall clock would report zero assessments for a roster
 * that plainly has some.
 */
export function summarise(learners: Learner[], asOf: string): SchoolSummary {
  const month = monthOf(asOf)

  const immunization: Record<ImmunizationStatus, number> = {
    complete: 0,
    incomplete: 0,
    none: 0,
  }

  let healthy = 0
  let needsMonitoring = 0
  let underweight = 0
  let assessedThisMonth = 0
  let awaitingSlip = 0
  let awaitingParent = 0
  let measured = 0

  for (const l of learners) {
    immunization[l.immunization]++

    if (!l.measuredOn) continue
    measured++

    if (monthOf(l.measuredOn) === month) assessedThisMonth++

    if (isFlagged(l)) {
      needsMonitoring++
      if (l.bmiBand && UNDERWEIGHT_BANDS.includes(l.bmiBand)) underweight++
      /* Attendance closes a follow-up; a printed slip does not. The parent
         turning up is the whole point of the invitation, so a slip sitting
         in a bag counts as outstanding work - just work owed by somebody
         else than the slip that has not been printed at all. */
      if (l.slip !== 'attended') {
        if (l.slip === 'not-printed') awaitingSlip++
        else awaitingParent++
      }
    } else {
      healthy++
    }
  }

  return {
    registered: learners.length,
    healthy,
    needsMonitoring,
    immunized: immunization.complete,
    underweight,
    assessedThisMonth,
    pendingFollowups: awaitingSlip + awaitingParent,
    awaitingSlip,
    awaitingParent,
    notYetMeasured: learners.length - measured,
    measured,
    immunization,
  }
}

/** One section's row on the admin table. */
export interface SectionSummary extends SchoolSummary {
  section: string
  grade: number
  adviser: string
}

/**
 * The same counts, per section.
 *
 * Sections come from the roster itself rather than from the SECTIONS table,
 * so a grade with no learners on file produces no row instead of a row of
 * zeroes claiming to describe a class that is not there.
 */
export function summariseBySection(
  learners: Learner[],
  asOf: string,
  adviserOf: (section: string) => string,
): SectionSummary[] {
  const groups = new Map<string, Learner[]>()
  for (const l of learners) {
    const g = groups.get(l.section)
    if (g) g.push(l)
    else groups.set(l.section, [l])
  }

  return [...groups.entries()]
    .map(([section, ls]) => ({
      ...summarise(ls, asOf),
      section,
      grade: ls[0].gradeLevel,
      adviser: adviserOf(section),
    }))
    .sort((a, b) => a.grade - b.grade)
}

/** A month as a school head would write it in a report: "August 2026". */
export function monthLabel(iso: string): string {
  const [y, m] = iso.split('-')
  const names = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ]
  return `${names[Number(m) - 1] ?? ''} ${y}`.trim()
}

/** A count as a share of a total, rounded, with a total of zero giving zero
    rather than NaN. Every percentage on the admin screen goes through this. */
export function pct(n: number, total: number): number {
  return total ? Math.round((n / total) * 100) : 0
}

/* =========================================================================
   The deeper cuts.

   Everything above this line answers "how many". Everything below answers a
   question a single count cannot: how the school splits, where the work is
   stalling, and which problems are landing on the same children.

   These exist because the head's questions are not the adviser's. An adviser
   with one class can read thirty records. A head with six cannot read 182, so
   the screen has to do the comparing for her - and the comparisons worth
   drawing are the ones that change what somebody does on Monday.
   ========================================================================= */

/** Below Normal on BMI-for-age. */
function isUnder(l: Learner): boolean {
  return l.bmiBand === 'Wasted' || l.bmiBand === 'Severely Wasted'
}

/** Above Normal on BMI-for-age. */
function isOver(l: Learner): boolean {
  return l.bmiBand === 'Overweight' || l.bmiBand === 'Obese'
}

/** Short for age. */
function isStunted(l: Learner): boolean {
  return l.hfaBand === 'Stunted' || l.hfaBand === 'Severely Stunted'
}

/* --- The status mix, grade by grade -------------------------------------- */

export interface GradeMix {
  section: string
  grade: number
  registered: number
  measured: number
  /** Every BMI band, including the empty ones. A stacked bar has to be able
      to lay out a zero-width segment without a lookup miss, and a legend that
      changes length between grades is unreadable. */
  bmi: Record<BmiBand, number>
  hfa: Record<HfaBand, number>
}

/**
 * One row per section, with the full band breakdown on both indices.
 *
 * This is the analytic the section table cannot carry. The table says Grade 6
 * has six learners needing monitoring; this says whether those six are wasted
 * or overweight, which are opposite problems with opposite interventions and
 * the same tally in a "needs monitoring" column.
 */
export function mixByGrade(learners: Learner[]): GradeMix[] {
  const groups = new Map<string, Learner[]>()
  for (const l of learners) {
    const g = groups.get(l.section)
    if (g) g.push(l)
    else groups.set(l.section, [l])
  }

  return [...groups.entries()]
    .map(([section, ls]) => {
      const bmi = Object.fromEntries(BMI_BANDS.map((b) => [b, 0])) as Record<BmiBand, number>
      const hfa = Object.fromEntries(HFA_BANDS.map((b) => [b, 0])) as Record<HfaBand, number>
      let measured = 0
      for (const l of ls) {
        if (!l.measuredOn) continue
        measured++
        if (l.bmiBand) bmi[l.bmiBand]++
        if (l.hfaBand) hfa[l.hfaBand]++
      }
      return { section, grade: ls[0].gradeLevel, registered: ls.length, measured, bmi, hfa }
    })
    .sort((a, b) => a.grade - b.grade)
}

/* --- Where the follow-up work stalls ------------------------------------- */

export interface Funnel {
  /** Measured and off Normal on either index. Everyone who is owed something. */
  flagged: number
  /** Of those, how many have had an invitation run off. */
  printed: number
  /** Of those, how many had a parent actually turn up. */
  attended: number
}

/**
 * The three stages of the school's own process, as counts that nest.
 *
 * `flagged >= printed >= attended` always, because the slip states are
 * ordered: a learner marked 'attended' was necessarily printed first. That
 * nesting is what makes the two drop-offs meaningful - the gap between
 * flagged and printed is paperwork the school has not done, and the gap
 * between printed and attended is parents who have not come. Those are
 * different failures with different fixes, and a single "16 pending" cannot
 * tell them apart.
 */
export function funnelOf(learners: Learner[]): Funnel {
  let flagged = 0
  let printed = 0
  let attended = 0
  for (const l of learners) {
    if (!l.measuredOn || !isFlagged(l)) continue
    flagged++
    if (l.slip === 'printed' || l.slip === 'attended') printed++
    if (l.slip === 'attended') attended++
  }
  return { flagged, printed, attended }
}

/* --- Boys and girls ------------------------------------------------------ */

export interface SexSplit {
  sex: Sex
  registered: number
  measured: number
  healthy: number
  needsMonitoring: number
  underweight: number
  immunized: number
}

/**
 * The same figures, disaggregated by sex.
 *
 * Not an optional nicety: every DepEd form this app feeds - the SF8 included -
 * reports male and female separately, so a head who has to fill one in from
 * this screen needs the split here or she is counting rows by hand. It is also
 * the cut most likely to hide something, because a school-wide rate that looks
 * ordinary can be two very different rates averaged together.
 */
export function bySex(learners: Learner[]): SexSplit[] {
  const make = (sex: Sex): SexSplit => ({
    sex,
    registered: 0,
    measured: 0,
    healthy: 0,
    needsMonitoring: 0,
    underweight: 0,
    immunized: 0,
  })
  const out: Record<Sex, SexSplit> = { M: make('M'), F: make('F') }

  for (const l of learners) {
    const r = out[l.sex]
    r.registered++
    if (l.immunization === 'complete') r.immunized++
    if (!l.measuredOn) continue
    r.measured++
    if (isFlagged(l)) {
      r.needsMonitoring++
      if (isUnder(l)) r.underweight++
    } else {
      r.healthy++
    }
  }

  return [out.M, out.F]
}

/* --- Which problems land on the same child ------------------------------- */

export interface Overlap {
  /** Low BMI, height normal or better. */
  wastedOnly: number
  /** Short for age, BMI normal. */
  stuntedOnly: number
  /** Both at once. The children in the most trouble, and the ones a
      single-index tally loses: they are counted once under "needs
      monitoring" and look like every other flagged learner. */
  wastedAndStunted: number
  /** High BMI AND short for age - the classic double burden of malnutrition,
      and the combination most likely to be read as "just overweight". */
  overweightAndStunted: number
  /** High BMI, height normal or better. */
  overweightOnly: number
  /** Tall for age and normal on BMI. Off Normal, so it is not "clear" - but
      it is also not a problem, and lumping it in with the wasted would be
      the one place on this screen where a flag means nothing. */
  tallOnly: number
  /** Measured, Normal on BOTH indices. Identical to SchoolSummary.healthy by
      construction, which is the point: if these two ever disagree, one of the
      two definitions has drifted. */
  clear: number
}

/**
 * The cross-tabulation of the two indices.
 *
 * Nothing else in CHAS shows this. Every other screen bands BMI and height
 * separately and then ORs them into "flagged", which is the right summary and
 * the wrong diagnosis: a child who is both wasted and stunted is a different
 * clinical picture from a child who is only one, and the school's own
 * response to them is not the same.
 *
 * The buckets are mutually exclusive and sum to the measured count, so this
 * can be drawn as parts of a whole without the total quietly exceeding the
 * roster.
 */
export function overlapOf(learners: Learner[]): Overlap {
  const o: Overlap = {
    wastedOnly: 0,
    stuntedOnly: 0,
    wastedAndStunted: 0,
    overweightAndStunted: 0,
    overweightOnly: 0,
    tallOnly: 0,
    clear: 0,
  }

  for (const l of learners) {
    if (!l.measuredOn) continue
    const under = isUnder(l)
    const over = isOver(l)
    const stunted = isStunted(l)

    if (under && stunted) o.wastedAndStunted++
    else if (under) o.wastedOnly++
    else if (over && stunted) o.overweightAndStunted++
    else if (over) o.overweightOnly++
    else if (stunted) o.stuntedOnly++
    else if (l.hfaBand === 'Tall') o.tallOnly++
    else o.clear++
  }

  return o
}
