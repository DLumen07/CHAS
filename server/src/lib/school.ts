/* The school year the school is in now.

   Read from the school row on every call rather than cached: the head can
   move the school to a new year, and a cached label would keep filing slips
   under the old one until the process restarted. It is one indexed lookup. */

import { db } from '../db.js'
import { notFound } from './errors.js'

export async function currentSchoolYear(schoolId: string): Promise<string> {
  const school = await db.school.findUnique({ where: { id: schoolId }, select: { schoolYear: true } })
  if (!school) throw notFound('The school has not been set up yet.', 'NO_SCHOOL')
  return school.schoolYear
}

/** "2026-2027" to "2027-2028". Null when the label is not in that shape. */
export function nextSchoolYear(year: string): string | null {
  const m = /^(\d{4})-(\d{4})$/.exec(year)
  if (!m || Number(m[2]) !== Number(m[1]) + 1) return null
  return `${Number(m[1]) + 1}-${Number(m[2]) + 1}`
}
