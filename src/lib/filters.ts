import type { Learner, SlipState } from '../data/mock'
import { BMI_BANDS, HFA_BANDS, type BmiBand, type HfaBand, type Sex } from './nutrition'

/* What narrows the roster.

   There used to be one control here: a rail of four mutually exclusive pills.
   It answered the daily question - "who is flagged" - and nothing else, so
   any real question ("which of my wasted boys still has no slip") was asked
   by reading thirty-one cards.

   The model is now six independent facets. Within a facet the values are OR
   (Wasted OR Severely Wasted); across facets they are AND (wasted AND no slip
   printed). An empty facet means "any", which is why the default filter is
   the empty object rather than a set of "All" sentinels: nothing to special
   case, and `active()` is just "is anything set".

   It lives here rather than in the screen because it is arithmetic over the
   roster, not layout - the counts beside each option need it too, and they
   need it one facet at a time. */

export interface LearnerFilter {
  /** Any band off Normal on either measure. The adviser's daily question. */
  flagged: boolean
  measured: 'any' | 'yes' | 'no'
  sex: Sex[]
  bmi: BmiBand[]
  hfa: HfaBand[]
  slip: SlipState[]
}

/** The facet keys, so a UI can iterate them and so `countsFor` can leave one
    out without a stringly-typed switch. */
export type FacetKey = keyof LearnerFilter

export const EMPTY_FILTER: LearnerFilter = {
  flagged: false,
  measured: 'any',
  sex: [],
  bmi: [],
  hfa: [],
  slip: [],
}

export const SLIP_LABEL: Record<SlipState, string> = {
  'not-printed': 'No slip printed',
  printed: 'Slip printed',
  attended: 'Attended the meeting',
}

export const SLIP_STATES: SlipState[] = ['not-printed', 'printed', 'attended']

export function isFlagged(l: Learner): boolean {
  return (
    (l.bmiBand !== null && l.bmiBand !== 'Normal') ||
    (l.hfaBand !== null && l.hfaBand !== 'Normal')
  )
}

/* One facet at a time, so `countsFor` can ask "would this learner survive
   everything except the group I am counting". */
function passes(l: Learner, f: LearnerFilter, facet: FacetKey): boolean {
  switch (facet) {
    case 'flagged':
      return !f.flagged || isFlagged(l)
    case 'measured':
      return f.measured === 'any' || (f.measured === 'yes' ? !!l.measuredOn : !l.measuredOn)
    case 'sex':
      return f.sex.length === 0 || f.sex.includes(l.sex)
    case 'bmi':
      return f.bmi.length === 0 || (l.bmiBand !== null && f.bmi.includes(l.bmiBand))
    case 'hfa':
      return f.hfa.length === 0 || (l.hfaBand !== null && f.hfa.includes(l.hfaBand))
    case 'slip':
      return f.slip.length === 0 || f.slip.includes(l.slip)
  }
}

const FACETS: FacetKey[] = ['flagged', 'measured', 'sex', 'bmi', 'hfa', 'slip']

export function matches(l: Learner, f: LearnerFilter): boolean {
  return FACETS.every((k) => passes(l, f, k))
}

/** How many facets are narrowing the list. The badge on the Filters button. */
export function activeCount(f: LearnerFilter): number {
  return (
    (f.flagged ? 1 : 0) +
    (f.measured !== 'any' ? 1 : 0) +
    f.sex.length +
    f.bmi.length +
    f.hfa.length +
    f.slip.length
  )
}

export function isEmpty(f: LearnerFilter): boolean {
  return activeCount(f) === 0
}

/* Faceted counts: how many learners each option WOULD leave visible, with
   every other facet still applied but this one ignored. Counting against the
   whole roster instead would put a "12" beside an option that yields nothing,
   which is worse than no number at all. */
export function countsFor<T extends string>(
  learners: Learner[],
  f: LearnerFilter,
  facet: FacetKey,
  values: readonly T[],
  valueOf: (l: Learner) => T | null,
): Record<string, number> {
  const pool = learners.filter((l) => FACETS.every((k) => k === facet || passes(l, f, k)))
  const out: Record<string, number> = {}
  for (const v of values) out[v] = 0
  for (const l of pool) {
    const v = valueOf(l)
    if (v !== null && v in out) out[v]++
  }
  return out
}

/** Everything currently applied, one removable chip each. */
export interface FilterChip {
  key: string
  label: string
  /** The colour of the band it names, for the chips that name one. */
  color?: string
  remove: (f: LearnerFilter) => LearnerFilter
}

export function chipsFor(f: LearnerFilter, colorOf: (band: string) => string): FilterChip[] {
  const out: FilterChip[] = []
  if (f.flagged)
    out.push({ key: 'flagged', label: 'Flagged', remove: (x) => ({ ...x, flagged: false }) })
  if (f.measured !== 'any')
    out.push({
      key: 'measured',
      label: f.measured === 'yes' ? 'Measured' : 'Not yet measured',
      remove: (x) => ({ ...x, measured: 'any' }),
    })
  for (const s of f.sex)
    out.push({
      key: `sex:${s}`,
      label: s === 'M' ? 'Male' : 'Female',
      remove: (x) => ({ ...x, sex: x.sex.filter((v) => v !== s) }),
    })
  for (const b of f.bmi)
    out.push({
      key: `bmi:${b}`,
      label: b,
      color: colorOf(b),
      remove: (x) => ({ ...x, bmi: x.bmi.filter((v) => v !== b) }),
    })
  for (const b of f.hfa)
    out.push({
      key: `hfa:${b}`,
      label: b,
      color: colorOf(b),
      remove: (x) => ({ ...x, hfa: x.hfa.filter((v) => v !== b) }),
    })
  for (const s of f.slip)
    out.push({
      key: `slip:${s}`,
      label: SLIP_LABEL[s],
      remove: (x) => ({ ...x, slip: x.slip.filter((v) => v !== s) }),
    })
  return out
}

export { BMI_BANDS, HFA_BANDS }
export type { BmiBand, HfaBand, Sex }
