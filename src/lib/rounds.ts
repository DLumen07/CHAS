/* Weigh-in rounds, the way DepEd schools run them.

   A school weighs every learner twice a school year: the BASELINE at the
   start (June to December) and the ENDLINE near the end (January to May),
   the same two rounds the School-Based Feeding Program reports on. A learner
   counts as "done" for the round once they have a measurement dated inside
   it, so the Weigh-in queue fills again by itself when the endline begins,
   without anyone having to open or close a round. */

import { schoolYearStart } from './school-year'
import { TODAY } from '../data/mock'

export interface Round {
  key: 'baseline' | 'endline'
  /** "Baseline weigh-in" */
  label: string
  /** ISO days, inclusive. */
  from: string
  to: string
}

/** The round `today` falls in. */
export function currentRound(today: string = TODAY): Round {
  const [y, m] = today.split('-').map(Number)
  /* The school year's first calendar year, from "2026-2027"; if today is
     outside that school year, the calendar decides. */
  const syStart = schoolYearStart()
  const inSy = (y === syStart && m >= 6) || (y === syStart + 1 && m <= 5)
  const baseline = inSy ? y === syStart : m >= 6
  const first = inSy ? syStart : baseline ? y : y - 1
  return baseline
    ? { key: 'baseline', label: 'Baseline weigh-in', from: `${first}-06-01`, to: `${first}-12-31` }
    : { key: 'endline', label: 'Endline weigh-in', from: `${first + 1}-01-01`, to: `${first + 1}-05-31` }
}

/** Whether a measurement date falls inside the round. */
export const inRound = (on: string | null | undefined, r: Round) => Boolean(on && on >= r.from && on <= r.to)
