/* The school year the school is in, who advises each section, and the
   school's own details.

   All three used to be constants - `SCHOOL`, `SCHOOL.schoolYear` and
   `SECTIONS[].adviser` - which was fine until the head could change them
   from the app. Against the server they now come with the roster (and,
   before sign-in, from /api/auth/school), so the header, the SF8, the slips
   and the weigh-in rounds all change the moment the head saves. The local
   build has no server and keeps the constants. */

import { useMemo, useSyncExternalStore } from 'react'
import { SCHOOL } from '../data/school'
import { SECTIONS } from '../data/mock'
import { slipTextOf, type SlipText } from './slip-text'
import type { SchoolClass } from './api'

/** The school as the SF8 header and the slips print it. */
export interface SchoolIdentity {
  name: string
  /** The DepEd School ID, or '' when it is not on file. */
  schoolId: string
  district: string
  division: string
  region: string
  /** Changes when the head uploads a logo; null means the logo shipped with
      the app. */
  logoVersion: string | null
}

interface SchoolInfo {
  schoolYear: string
  /** Section name to adviser name. */
  advisers: Record<string, string>
  /** Every class the school has, in grade order, whether or not anyone is
      enrolled in it yet. */
  classes: SchoolClass[]
  school: SchoolIdentity
  /** The slip's wording, defaults filled in. */
  slipText: SlipText
}

let info: SchoolInfo = {
  schoolYear: SCHOOL.schoolYear,
  advisers: Object.fromEntries(SECTIONS.map((s) => [s.name, s.adviser])),
  classes: SECTIONS.map((s) => ({ name: s.name, gradeLevel: s.grade, gradeName: `Grade ${s.grade}` })),
  school: {
    name: SCHOOL.name,
    schoolId: SCHOOL.id,
    district: SCHOOL.district,
    division: SCHOOL.division,
    region: SCHOOL.region,
    logoVersion: null,
  },
  slipText: slipTextOf(null),
}
const listeners = new Set<() => void>()

export function setSchoolInfo(patch: Partial<SchoolInfo>) {
  const next = { ...info, ...patch }
  /* Every roster refresh sends all of it again; only a real change
     re-renders. */
  if (JSON.stringify(next) === JSON.stringify(info)) return
  info = next
  for (const l of listeners) l()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** For code outside React: the rounds, the SF8 builder. */
export function schoolYear(): string {
  return info.schoolYear
}

/** For code outside React: the SF8 header. */
export function schoolIdentity(): SchoolIdentity {
  return info.school
}

/** The first calendar year of the school year: 2026 for "2026-2027". */
export function schoolYearStart(year: string = info.schoolYear): number {
  return Number(year.slice(0, 4))
}

export function useSchoolInfo(): SchoolInfo {
  return useSyncExternalStore(subscribe, () => info, () => info)
}

export function useSchoolYear(): string {
  return useSchoolInfo().schoolYear
}

export function useSchool(): SchoolIdentity {
  return useSchoolInfo().school
}

export function useSlipText(): SlipText {
  return useSchoolInfo().slipText
}

/** The class names a filter offers, in grade order: every class the school
    has, empty ones included, plus any class a learner is in that the list
    does not know of yet. */
export function classNames(
  classes: SchoolClass[],
  learners: { section: string; gradeLevel: number }[],
): { name: string; level: number }[] {
  const seen = new Map<string, number>()
  for (const c of classes) seen.set(c.name, c.gradeLevel)
  for (const l of learners) if (!seen.has(l.section)) seen.set(l.section, l.gradeLevel)
  return [...seen]
    .map(([name, level]) => ({ name, level }))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
}

export function useClassNames(learners: { section: string; gradeLevel: number }[]): { name: string; level: number }[] {
  const { classes } = useSchoolInfo()
  return useMemo(() => classNames(classes, learners), [classes, learners])
}
