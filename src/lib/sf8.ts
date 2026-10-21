/* Turning a grade level into a filled-in SF8, ready to be saved as a PDF.

   The form is one sheet per grade and section, males listed first and then
   females, fifty rows each, alphabetical. Everyone enrolled appears - a
   learner who was not on the scale gets their name, LRN and birthdate and
   leaves the weight and height blank, which is exactly what a hand-filled
   SF8 looks like mid-session.

   A PDF, NOT THE WORKBOOK. The SF8 used to leave the app as the school's own
   .xlsx with the five typed fields written into it. A workbook is a file
   anyone can retype a cell in, and the submitted SF8 should be the figures
   CHAS recorded, so the export is now a PDF of the same form (the user's
   call, 2026-10-12).

   The figures on it are still the workbook's own arithmetic. The template is
   read at export time for its per-month cut-off tables (see readSf8Form in
   electron/sf8-core.mjs), and `computeSf8` below is the sheet's formulas
   written out once, column by column:

     H  Age              CalSheet's year/month chain from Birthdate to the
                         date of assessment, written as years.months
     K  Height²          J*J
     L  BMI              I/K
     M  BMI Category     VLOOKUP(age, BMI) against the four cut-offs
     N  Height for Age   VLOOKUP(age, HEIGHT) against the three cut-offs

   so a learner is banded against the same table row the workbook would have
   used, and an age the tables do not cover shows #N/A exactly as the sheet
   would. The only departure is the template's H14, which is empty where every
   other row has the age formula; the PDF gives the third boy his age.

   Both the installed app and a browser tab build it the same way: the
   template is a bundled asset, read and inflated in the page. Only the last
   step differs - the installed app writes the PDF through a save dialog, a
   browser tab opens its print window. */

import { CAPACITY, readSf8Form, type Sf8FormAssets } from '../../electron/sf8-core.mjs'
import templateUrl from '../../electron/templates/sf8-template.xlsx?url'
import { schoolIdentity, schoolYear } from './school-year'
import type { Learner } from '../data/mock'

export interface Sf8Row {
  lrn: string
  name: string
  birthDate: string
  weightKg: number | null
  heightCm: number | null
}

export interface Sf8Job {
  header: {
    schoolName: string
    schoolId: string
    district: string
    division: string
    region: string
    grade: string
    section: string
    track: string
    schoolYear: string
    adviser: string
  }
  assessedOn: string
  males: Sf8Row[]
  females: Sf8Row[]
}

/* --- the browser's codec ------------------------------------------------- */

/* Raw DEFLATE, which is what a ZIP member is, straight from the platform.
   No library: the browser has had this since 2022 and Electron's Chromium
   has it too. */
function inflateRaw(): ((bytes: Uint8Array) => Promise<Uint8Array>) | undefined {
  const D = (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream
  if (!D) return undefined
  return async (bytes) => {
    // A Blob rather than a hand-rolled ReadableStream, so a subarray view is
    // copied at its own offsets and not from the start of its backing buffer.
    const piped = new Blob([bytes as BlobPart]).stream().pipeThrough(new D('deflate-raw'))
    return new Uint8Array(await new Response(piped).arrayBuffer())
  }
}

/** True when this window can read the template, which the PDF needs. */
export function canExportSf8(): boolean {
  return Boolean(inflateRaw())
}

/* --- the payload -------------------------------------------------------- */

/** DepEd writes the name last-first. The middle name goes in full: the form
    has the width for it and an initial is not a name. */
function formName(l: Learner): string {
  return `${l.lastName}, ${l.firstName} ${l.middleName}`.trim()
}

const byName = (a: Sf8Row, b: Sf8Row) => a.name.localeCompare(b.name)

const toRow = (l: Learner): Sf8Row => ({
  lrn: l.lrn,
  name: formName(l),
  birthDate: l.birthDate,
  weightKg: l.weightKg,
  heightCm: l.heightCm,
})

/** How many learners of one sex the form has room for. The number belongs to
    the template, so it is read from the module that knows the template's
    row blocks rather than restated here. */
export const SF8_CAPACITY = CAPACITY

export function buildSf8Job({
  learners,
  grade,
  adviser,
  assessedOn,
}: {
  learners: Learner[]
  grade: string
  adviser: string
  assessedOn: string
}): Sf8Job {
  const inGrade = learners.filter((l) => l.section === grade)
  return {
    header: {
      schoolName: schoolIdentity().name,
      schoolId: schoolIdentity().schoolId,
      district: schoolIdentity().district,
      division: schoolIdentity().division,
      region: schoolIdentity().region,
      /* The Grade cell takes the year level as the school names it, less
         the word "Grade"; the Section cell takes the section. Where a school
         runs one section per year the two carry the same name, and both
         cells are still filled because a blank one reads as an oversight. */
      grade: (inGrade[0]?.gradeName ?? grade).replace(/^Grade\s*/i, ''),
      section: grade,
      track: 'N/A',
      schoolYear: schoolYear(),
      adviser,
    },
    assessedOn,
    males: inGrade.filter((l) => l.sex === 'M').map(toRow).sort(byName),
    females: inGrade.filter((l) => l.sex === 'F').map(toRow).sort(byName),
  }
}

/* --- the template ------------------------------------------------------- */

interface Sf8Bridge {
  template: () => Promise<Uint8Array>
}
const bridge = (): Sf8Bridge | undefined =>
  (window as unknown as { chas?: { sf8?: Sf8Bridge } }).chas?.sf8

/** The template's bytes. The installed app reads its own copy from disk
    through the main process; its page may be file://, which cannot fetch. A
    browser tab fetches the bundled asset, a same-origin read of a file the
    page shipped with - not a network call in the sense the offline build
    cares about. */
async function readTemplate(): Promise<Uint8Array> {
  const b = bridge()
  if (b) return new Uint8Array(await b.template())
  const res = await fetch(templateUrl)
  if (!res.ok) throw new Error(`could not read the SF8 template (${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}

let assets: Promise<Sf8FormAssets> | undefined

/** The template's tables and pictures, read once per session. */
export function loadSf8Assets(): Promise<Sf8FormAssets> {
  const inflate = inflateRaw()
  if (!inflate) return Promise.reject(new Error('this window cannot read the SF8 template'))
  if (assets) return assets
  const pending = readTemplate().then((template) =>
    readSf8Form({ template, codec: { inflateRaw: inflate } }),
  )
  // A failed read is not kept, so the next export tries again.
  pending.catch(() => {
    if (assets === pending) assets = undefined
  })
  assets = pending
  return pending
}

/* --- the sheet's formulas ------------------------------------------------ */

/** What one learner row of the sheet shows. Numbers are as the cells hold
    them; the form's 0.00 formatting is applied when drawn. A string is
    either a band name, '' for a blank cell or '#N/A' as Excel shows it. */
export interface Sf8FormRow extends Sf8Row {
  age: number | null
  heightM: number | null
  heightSq: number | null
  bmi: number | null
  bmiCategory: string
  hfa: string
}

export const BMI_BANDS = ['Severely Wasted', 'Wasted', 'Normal', 'Overweight', 'Obese'] as const
export const HFA_BANDS = ['Severely Stunted', 'Stunted', 'Normal', 'Tall'] as const

export interface Sf8Form {
  job: Sf8Job
  males: Sf8FormRow[]
  females: Sf8FormRow[]
  /** COUNTIF(NSMALE, band) and friends: the summary table under the list. */
  summary: {
    bmi: { male: number[]; female: number[] }
    hfa: { male: number[]; female: number[] }
  }
}

const NA = '#N/A'

/** CalSheet R:AD. Age in completed years and months, written the way the
    form writes it and then read back as a number: VALUE("8.04") is 8.04,
    VALUE("8.10") is 8.1. Blank when there is no birthdate, as H's IF(G="")
    makes it; also blank with no date of assessment, where the sheet would
    measure from 1900 and print a negative age. */
function formAge(birth: string, on: string): number | null {
  const [by, bm, bd] = birth.split('-').map(Number)
  const [cy, cm, cd] = on.split('-').map(Number)
  if (!by || !bm || !bd || !cy || !cm || !cd) return null
  const z = cd >= bd ? cm : cm - 1 // tempMon
  const months = z >= bm ? z - bm : z + 12 - bm // agemonth
  const year = z >= bm ? cy : cy - 1 // tempyear
  const years = year >= by ? year - by : year - 1 - by // ageYear
  return Number(`${years}.${months >= 10 ? months : `0${months}`}`)
}

/* The table keys were typed as 5, 5.01 ... and some carry binary noise
   (18.100000000000016). Compared at the two decimals they were written to. */
const key2 = (n: number) => Math.round(n * 100) / 100

/** VLOOKUP(age, table, col) with an approximate match: the last row whose
    key is not above the age. Undefined is #N/A. */
function lookup(table: number[][], age: number | null): number[] | undefined {
  if (age === null) return undefined
  const a = key2(age)
  let hit: number[] | undefined
  for (const row of table) {
    if (key2(row[0]) <= a) hit = row
    else break
  }
  return hit
}

/* Excel compares at about fifteen significant digits, so 1.305*100 is not
   "more than" 130.5 there. Rounded the same way here. */
const gt = (a: number, b: number) => Number(a.toPrecision(12)) > Number(b.toPrecision(12))

function computeRow(row: Sf8Row, on: string, assets: Sf8FormAssets, female: boolean): Sf8FormRow {
  const age = row.birthDate ? formAge(row.birthDate, on) : null
  const heightM = Number.isFinite(row.heightCm) ? (row.heightCm as number) / 100 : null
  const weight = Number.isFinite(row.weightKg) ? (row.weightKg as number) : null
  const heightSq = heightM === null ? null : heightM * heightM
  const bmi = weight === null || heightSq === null ? null : weight / heightSq

  // VLOOKUP columns 3-10 for boys and 11-18 for girls, minus one for the index.
  const b = female ? 10 : 2
  let bmiCategory = ''
  if (bmi !== null) {
    const r = lookup(assets.bmi, age)
    if (!r) bmiCategory = NA
    else if (gt(bmi, r[b + 6])) bmiCategory = 'Obese'
    else if (gt(bmi, r[b + 4])) bmiCategory = 'Overweight'
    else if (gt(bmi, r[b + 2])) bmiCategory = 'Normal'
    else if (gt(bmi, r[b])) bmiCategory = 'Wasted'
    else bmiCategory = 'Severely Wasted'
  }

  // HEIGHT columns 3-8 for boys and 9-14 for girls.
  const h = female ? 8 : 2
  let hfa = ''
  if (age !== null && heightM !== null) {
    const r = lookup(assets.height, age)
    const cm = heightM * 100
    if (!r) hfa = NA
    else if (gt(cm, r[h + 4])) hfa = 'Tall'
    else if (gt(cm, r[h + 2])) hfa = 'Normal'
    else if (gt(cm, r[h])) hfa = 'Stunted'
    else hfa = 'Severely Stunted'
  }

  return { ...row, age, heightM, heightSq, bmi, bmiCategory, hfa }
}

export function computeSf8(job: Sf8Job, assets: Sf8FormAssets): Sf8Form {
  const males = job.males.map((r) => computeRow(r, job.assessedOn, assets, false))
  const females = job.females.map((r) => computeRow(r, job.assessedOn, assets, true))
  const count = (rows: Sf8FormRow[], pick: (r: Sf8FormRow) => string, bands: readonly string[]) =>
    bands.map((band) => rows.filter((r) => pick(r) === band).length)
  return {
    job,
    males,
    females,
    summary: {
      bmi: {
        male: count(males, (r) => r.bmiCategory, BMI_BANDS),
        female: count(females, (r) => r.bmiCategory, BMI_BANDS),
      },
      hfa: {
        male: count(males, (r) => r.hfa, HFA_BANDS),
        female: count(females, (r) => r.hfa, HFA_BANDS),
      },
    },
  }
}

/** `SF8-Grade-3-2026-08-10.pdf` */
export function sf8FileName(grade: string, on: string): string {
  return `SF8-${grade.replace(/\s+/g, '-')}-${on}.pdf`
}
