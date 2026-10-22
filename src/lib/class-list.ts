/* Reading a class list from an SF1 (School Form 1, School Register).

   WHAT IS ACCEPTED. The SF1 as an .xlsx workbook, its first sheet. Both the
   blank DepEd form the app hands out (public/sf1-school-register.xlsx) and
   the SF1 that LIS exports have the same shape: title rows with School Year,
   Grade Level and Section, a header row with "LRN", a name column written
   "LAST, FIRST, MIDDLE", sex and birth date - then one row per learner,
   with "TOTAL" rows between the boys and the girls, and the legend of
   remark codes below the last one. Since 2026-10-22 the SF1 is the only
   file taken; the CSV template it replaced is gone.

   NO LIBRARY. An .xlsx file is a zip of XML. The browser already has the two
   things needed to read one - DecompressionStream for the zip and DOMParser
   for the XML - and a spreadsheet package would be the largest dependency in
   an app that ships offline on one laptop. Only what a class list uses is
   read: text, numbers, and the first sheet. Formulas come through as their
   saved values.

   NOTHING IS GUESSED SILENTLY. Every row the file seems to hold a learner on
   comes back, with a reason when it cannot be imported, so the preview shows
   the nurse exactly what will and will not be added. */

import type { ImportLearnerRow } from './api'
import { isValidName } from './names'

/** A learner as read; `sex` is blank when the cell could not be read. */
export type ClassListLearner = Omit<ImportLearnerRow, 'sex'> & { sex: 'M' | 'F' | '' }

export interface ClassListRow {
  /** The row number as the spreadsheet shows it, for "row 14: ...". */
  line: number
  learner: ClassListLearner
  /** Why this row cannot be imported, or null when it is ready. */
  problem: string | null
}

/** The rows of the file's first sheet, as text. */
export async function readSpreadsheet(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xlsx')) return readXlsx(new Uint8Array(await file.arrayBuffer()))
  if (name.endsWith('.xls')) {
    throw new Error('Old .xls files cannot be read. Open the SF1 in Excel, save it as .xlsx and try again.')
  }
  throw new Error('Choose the SF1 as an Excel (.xlsx) file.')
}

/** What the SF1's title rows say the list is for. Blank when not filled in. */
export interface Sf1Heading {
  schoolYear: string
  gradeLevel: string
  section: string
}

/* Each title is its own cell with the value in the next filled cell to its
   right ("Grade Level" | | "Grade 7"). Some copies type both into one cell,
   "Grade Level: 7", which is read too. */
export function readSf1Heading(rows: string[][]): Sf1Heading {
  const out: Sf1Heading = { schoolYear: '', gradeLevel: '', section: '' }
  const LABELS: [keyof Sf1Heading, RegExp][] = [
    ['schoolYear', /^school\s*year\b/i],
    ['gradeLevel', /^grade\s*level\b/i],
    ['section', /^section\b/i],
  ]
  const isLabel = (v: string) =>
    /^(school\s*(id|name|year)|region|division|district|grade\s*level|section)\b/i.test(v.trim())
  for (const row of rows.slice(0, 8)) {
    row.forEach((raw, i) => {
      const v = (raw ?? '').trim()
      for (const [key, re] of LABELS) {
        if (!re.test(v) || out[key]) continue
        const inline = v.replace(re, '').replace(/^[\s:]+/, '').trim()
        if (inline) out[key] = inline
        else {
          const next = row.slice(i + 1).map((c) => (c ?? '').trim()).find(Boolean) ?? ''
          if (next && !isLabel(next)) out[key] = next
        }
      }
    })
  }
  return out
}

/* --- Finding the learners ---------------------------------------------- */

type Column = 'lrn' | 'name' | 'last' | 'first' | 'middle' | 'ext' | 'sex' | 'birth'

function columnOf(header: string): Column | null {
  const h = header.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!h) return null
  if (/\blrn\b|learner reference/.test(h)) return 'lrn'
  /* Not "Birth Place", which an SF1 also has. */
  if (/birth|\bdob\b/.test(h) && !/place/.test(h)) return 'birth'
  if (/\bsex\b|gender/.test(h)) return 'sex'
  if (/ext|suffix/.test(h) && !/last.*first/.test(h)) return 'ext'
  /* "NAME (Last Name, First Name, Middle Name)" names all three, so it is the
     combined column; a header naming only one of them is that one. */
  const parts = ['last', 'first', 'middle'].filter((p) => h.includes(p)).length
  if (parts >= 2) return 'name'
  if (/last|surname|family/.test(h)) return 'last'
  if (/first|given/.test(h)) return 'first'
  if (/middle/.test(h)) return 'middle'
  if (/name/.test(h)) return 'name'
  return null
}

/** Turns the sheet into learners, one entry per row that holds one. */
export function toClassList(rows: string[][]): ClassListRow[] {
  /* The header is the first row, among the first thirty, with an LRN column
     and some kind of name column. */
  let head = -1
  let cols: Partial<Record<Column, number>> = {}
  for (let r = 0; r < Math.min(rows.length, 30) && head < 0; r++) {
    const found = mapColumns(rows[r])
    if (found.lrn !== undefined && (found.name !== undefined || found.last !== undefined)) {
      head = r
      cols = found
      /* An SF1 may split the name under a merged "NAME" cell, with "Last
         Name / First Name / Middle Name" on the row beneath it. */
      const below = mapColumns(rows[r + 1] ?? [])
      if (below.last !== undefined && below.first !== undefined) {
        cols = { ...cols, ...below }
        if (cols.name === below.last || cols.name === below.first) delete cols.name
        head = r + 1
      }
    }
  }
  if (head < 0) {
    throw new Error('This file is not an SF1. The LRN and Name columns were not found.')
  }
  if (cols.sex === undefined) throw new Error('The SF1 has no Sex column.')
  if (cols.birth === undefined) throw new Error('The SF1 has no Birth date column.')

  const out: ClassListRow[] = []
  const seen = new Map<string, number>()

  for (let r = head + 1; r < rows.length; r++) {
    const row = rows[r]
    /* The legend of remark codes and the signatures sit under the last
       learner. Nothing below them is a learner. */
    if (row.some((v) => /list and code of indicators|prepared by|certified correct/i.test(v ?? ''))) break
    const cell = (c: Column) => (cols[c] === undefined ? '' : (row[cols[c]!] ?? '').trim())

    const rawLrn = cell('lrn')
    const rawName = cell('name') || [cell('last'), cell('first')].filter(Boolean).join(', ')
    /* Blank rows, and the "<=== TOTAL MALE ===>" lines between the boys and
       the girls, hold no learner. */
    if (!rawLrn && (!rawName || /total/i.test(rawName))) continue
    if (/total/i.test(rawLrn)) continue

    const name =
      cols.name !== undefined && cols.last === undefined
        ? splitName(cell('name'))
        : { last: cell('last'), first: cell('first'), middle: cell('middle'), ext: '' }

    const lrn = rawLrn.replace(/\.0+$/, '').replace(/[\s-]/g, '')
    const sex = toSex(cell('sex'))
    const birthDate = toIsoDate(cell('birth'))

    const learner: ClassListLearner = {
      lrn,
      lastName: tidy(name.last),
      firstName: tidy(name.first),
      middleName: tidy(name.middle) || undefined,
      nameExt: (cell('ext') || name.ext) || undefined,
      sex: sex ?? '',
      birthDate: birthDate ?? '',
    }

    let problem: string | null = null
    if (!lrn) problem = 'No LRN.'
    else if (!/^\d{12}$/.test(lrn)) problem = 'The LRN must be 12 digits.'
    else if (seen.has(lrn)) problem = `Same LRN as row ${seen.get(lrn)}.`
    else if (!learner.lastName || !learner.firstName) problem = 'The name is incomplete.'
    else if (
      [learner.lastName, learner.firstName, learner.middleName, learner.nameExt].some(
        (n) => n && !isValidName(n),
      )
    )
      problem = 'The name can only have letters, spaces, hyphens, apostrophes and periods.'
    else if (!sex) problem = 'Sex must be M or F.'
    else if (!birthDate) problem = 'The birth date cannot be read.'
    else if (birthDate > todayIso()) problem = 'The birth date is in the future.'

    if (/^\d{12}$/.test(lrn) && !seen.has(lrn)) seen.set(lrn, r + 1)
    out.push({ line: r + 1, learner, problem })
  }
  return out
}

function mapColumns(row: string[]): Partial<Record<Column, number>> {
  const found: Partial<Record<Column, number>> = {}
  row.forEach((v, i) => {
    const c = columnOf(v ?? '')
    if (c && found[c] === undefined) found[c] = i
  })
  return found
}

/** "DELA CRUZ, JUAN, SANTOS" or "DELA CRUZ, JUAN SANTOS". */
function splitName(s: string): { last: string; first: string; middle: string; ext: string } {
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean)
  let ext = ''
  /* "DELA CRUZ, JR., JUAN" or "DELA CRUZ, JUAN JR., SANTOS" */
  const EXT = /^(jr|sr|ii|iii|iv|v)\.?$/i
  const i = parts.findIndex((p, n) => n > 0 && EXT.test(p))
  if (i > 0) ext = parts.splice(i, 1)[0]
  if (parts.length >= 2) {
    const firstWords = parts[1].split(/\s+/)
    if (!ext && firstWords.length > 1 && EXT.test(firstWords[firstWords.length - 1])) {
      ext = firstWords.pop()!
      parts[1] = firstWords.join(' ')
    }
  }
  return {
    last: parts[0] ?? '',
    first: parts[1] ?? '',
    middle: parts.slice(2).join(' '),
    ext: ext ? tidyExt(ext) : '',
  }
}

function tidyExt(s: string): string {
  const t = s.replace(/\.$/, '')
  return /^(jr|sr)$/i.test(t) ? `${t[0].toUpperCase()}${t.slice(1).toLowerCase()}.` : t.toUpperCase()
}

/** LIS writes names in capitals. "DELA CRUZ" reads as "Dela Cruz". */
function tidy(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (t !== t.toUpperCase()) return t
  return t.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase())
}

function toSex(s: string): 'M' | 'F' | null {
  const t = s.trim().toLowerCase()
  if (t === 'm' || t === 'male') return 'M'
  if (t === 'f' || t === 'female') return 'F'
  return null
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function validIso(y: number, m: number, d: number): string | null {
  if (y < 1900 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCMonth() !== m - 1) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** A birth date as YYYY-MM-DD, or null. Month first, as LIS writes it. */
function toIsoDate(s: string): string | null {
  const t = s.trim()
  if (!t) return null
  /* An Excel date stored as a day count: 43200 is 2018-04-10. */
  if (/^\d{4,5}(\.\d+)?$/.test(t)) {
    const days = Math.floor(Number(t))
    const dt = new Date(Date.UTC(1899, 11, 30) + days * 86_400_000)
    return validIso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
  }
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (m) return validIso(+m[1], +m[2], +m[3])
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/)
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
    return validIso(y, +m[1], +m[2])
  }
  /* "April 9, 2018", "09-Apr-2018" */
  m = t.match(/^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/i)
  if (m) {
    const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase())
    if (mo >= 0) return validIso(+m[3], mo + 1, +m[2])
  }
  m = t.match(/^(\d{1,2})[-\s]([a-z]+)\.?[-\s,]+(\d{4})$/i)
  if (m) {
    const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase())
    if (mo >= 0) return validIso(+m[3], mo + 1, +m[1])
  }
  return null
}

/* --- XLSX ---------------------------------------------------------------- */

async function readXlsx(bytes: Uint8Array): Promise<string[][]> {
  const zip = readZip(bytes)
  const text = async (path: string) => {
    const entry = zip.get(path)
    return entry ? new TextDecoder().decode(await entry()) : null
  }
  const xml = (s: string) => new DOMParser().parseFromString(s, 'application/xml')
  const all = (doc: Document | Element, tag: string) => Array.from(doc.getElementsByTagNameNS('*', tag))

  /* The first sheet in the workbook's own order, which is not always
     sheet1.xml once sheets have been moved or deleted. */
  let sheetPath = 'xl/worksheets/sheet1.xml'
  const wb = await text('xl/workbook.xml')
  const rels = await text('xl/_rels/workbook.xml.rels')
  if (wb && rels) {
    const first = all(xml(wb), 'sheet')[0]
    const rid =
      first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ??
      first?.getAttribute('r:id')
    const target = all(xml(rels), 'Relationship')
      .find((r) => r.getAttribute('Id') === rid)
      ?.getAttribute('Target')
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
  }

  const shared: string[] = []
  const ss = await text('xl/sharedStrings.xml')
  if (ss) {
    for (const si of all(xml(ss), 'si')) {
      shared.push(all(si, 't').map((t) => t.textContent ?? '').join(''))
    }
  }

  const sheet = await text(sheetPath)
  if (!sheet) throw new Error('The workbook has no sheet that can be read.')

  const rows: string[][] = []
  for (const r of all(xml(sheet), 'row')) {
    const index = Number(r.getAttribute('r') ?? rows.length + 1) - 1
    const row: string[] = []
    for (const c of all(r, 'c')) {
      const ref = c.getAttribute('r') ?? ''
      const col = colIndex(ref.replace(/\d+$/, '')) ?? row.length
      const type = c.getAttribute('t')
      const v = all(c, 'v')[0]?.textContent ?? ''
      let value: string
      if (type === 's') value = shared[Number(v)] ?? ''
      else if (type === 'inlineStr') value = all(c, 't').map((t) => t.textContent ?? '').join('')
      else value = v
      row[col] = value
    }
    rows[index] = Array.from(row, (v) => v ?? '')
  }
  return Array.from(rows, (r) => r ?? [])
}

function colIndex(letters: string): number | null {
  if (!letters) return null
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** The entries of a zip, each read on demand. */
function readZip(bytes: Uint8Array): Map<string, () => Promise<Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  /* The end-of-central-directory record, found from the back: it is
     followed by a comment of up to 64 KB. */
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65_535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('The file is not a valid .xlsx workbook.')

  const count = view.getUint16(eocd + 10, true)
  let p = view.getUint32(eocd + 16, true)
  const entries = new Map<string, () => Promise<Uint8Array>>()
  const decoder = new TextDecoder()

  for (let k = 0; k < count; k++) {
    if (view.getUint32(p, true) !== 0x02014b50) break
    const method = view.getUint16(p + 10, true)
    const size = view.getUint32(p + 20, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const local = view.getUint32(p + 42, true)
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen))
    p += 46 + nameLen + extraLen + commentLen

    entries.set(name, async () => {
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
      const data = bytes.subarray(start, start + size)
      if (method === 0) return data
      if (method !== 8) throw new Error('The workbook uses a compression this app cannot read.')
      const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      return new Uint8Array(await new Response(stream).arrayBuffer())
    })
  }
  return entries
}
