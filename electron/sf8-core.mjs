/* SF8 export, the part that has no environment.

   SINCE 2026-10-12 THE APP EXPORTS A PDF, not this workbook. What it calls
   here is readSf8Form (near the bottom), which reads the template's tables
   and pictures for src/lib/sf8.ts to draw the form with. buildSf8 below - the
   workbook writer - is kept, documented, and no longer called.

   This is the whole of the export - the ZIP surgery and the cell surgery -
   written against nothing but Uint8Array, TextEncoder and TextDecoder. It
   never reads a file, never writes one, and does not know how to deflate.
   Compression is handed in, because the two places this runs have different
   ones: Electron passes node:zlib, the browser tab passes CompressionStream.

   It lives in electron/ rather than src/ for one dull reason: this directory
   is already in the packaged app's `files` list, and Vite will bundle a
   module from anywhere in the project. Both callers can therefore import the
   SAME file, which is the point. There is exactly one copy of the knowledge
   about which cells the SF8 keeps its data in, and a fix to it cannot land in
   the desktop build and miss the browser one.

   WHAT THE EXPORT DOES. It does NOT draw a form that looks like the SF8. It
   opens the school's actual SF8 workbook - shipped in electron/templates -
   and types into it: the header block, then LRN, name, birthdate, weight and
   height for each learner, into the same cells a nurse would use.

   Everything else is left exactly as found. The age, BMI, BMI category and
   height-for-age columns are the workbook's own formulas against its own
   per-month tables, so the numbers on the sheet are DepEd's arithmetic, not
   ours. That is deliberate: it means the output cannot disagree with the form
   it claims to be, and a reviewer can check any cell's formula and find the
   one that shipped with the file.

   Almost every formula in the sheet is a SHARED formula: Excel writes the
   expression once on a master cell, with a ref covering the range, and every
   other cell in the group carries only <f t="shared" si="n"/>. Overwriting a
   master would silently blank its whole column, so this file writes into the
   input cells only - B, C, G, I and J, which carry no formulas at all - and
   `put` refuses outright to overwrite anything containing an <f>.

   Two cells are outside every shared group and are genuinely broken in the
   template. They are repaired, because our data would otherwise be shown
   against a blank or a stale number:

     - A12, the first learner's row number, is an empty cell. The shared group
       for that column starts at A13.
     - K13, the second learner's Height², holds a literal 2.24 left over from
       whoever typed over it. K12 has its own formula and the shared group
       starts at K14, so K13 fell through the gap.

   Both are restored to the expression their neighbours already use. The
   only other change is that the form author's "Sir Wedz Helper Tables" tab
   is removed - see dropHelperSheet at the bottom. Nothing else in the
   workbook is touched. L13 looks broken in the same way but is
   not - it is a member of the shared group mastered at L12 - so it is left
   alone.

   ZIP SUPPORT. Deliberately not supported: ZIP64, encryption, and multi-disk
   archives. None occur in a 1.5MB spreadsheet, and a loud throw is better
   than a silently wrong file. Every entry we do not touch is copied through
   byte for byte, still deflated, never re-encoded - so the file that comes
   out is the file that went in, with our data in it, and nothing about the
   form can drift because we opened it.
*/

/** Rows the form reserves for learners: 50 male, then 50 female. */
const MALE_ROWS = { first: 12, last: 61 }
const FEMALE_ROWS = { first: 63, last: 112 }
export const CAPACITY = MALE_ROWS.last - MALE_ROWS.first + 1

const SHEET = 'xl/worksheets/sheet2.xml'
const WORKBOOK = 'xl/workbook.xml'

const utf8 = new TextEncoder()
const decoder = new TextDecoder('utf-8')

/* --- bytes -------------------------------------------------------------- */

const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50

function concat(chunks) {
  let total = 0
  for (const c of chunks) total += c.length
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/** A little-endian reader/writer over one Uint8Array. An .xlsx is a ZIP and
    every field in a ZIP is little-endian regardless of the host. */
const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

/* --- CRC32 -------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

export function crc32(bytes) {
  let c = -1
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/* --- read --------------------------------------------------------------- */

/** Every entry, in the archive's own order, with its raw (still compressed)
    bytes kept alongside so untouched entries can be written straight back. */
export function readZip(bytes) {
  const dv = view(bytes)
  // The end-of-central-directory record is last, after a comment of unknown
  // length, so it has to be found by scanning backwards for its signature.
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 0xffff; i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('not a zip: no end-of-central-directory record')

  const count = dv.getUint16(eocd + 10, true)
  let p = dv.getUint32(eocd + 16, true)
  if (p === 0xffffffff) throw new Error('ZIP64 archives are not supported')

  const entries = []
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== CENTRAL_SIG) throw new Error('corrupt central directory')
    const flags = dv.getUint16(p + 8, true)
    const method = dv.getUint16(p + 10, true)
    const time = dv.getUint16(p + 12, true)
    const date = dv.getUint16(p + 14, true)
    const crc = dv.getUint32(p + 16, true)
    const compSize = dv.getUint32(p + 20, true)
    const rawSize = dv.getUint32(p + 24, true)
    const nameLen = dv.getUint16(p + 28, true)
    const extraLen = dv.getUint16(p + 30, true)
    const commentLen = dv.getUint16(p + 32, true)
    const localOff = dv.getUint32(p + 42, true)
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen))
    if (flags & 0x1) throw new Error(`encrypted entry: ${name}`)

    // The local header's extra field can differ in length from the central
    // one's, so the data offset has to be read from the local header itself.
    if (dv.getUint32(localOff, true) !== LOCAL_SIG) throw new Error(`corrupt local header: ${name}`)
    const lNameLen = dv.getUint16(localOff + 26, true)
    const lExtraLen = dv.getUint16(localOff + 28, true)
    const dataOff = localOff + 30 + lNameLen + lExtraLen

    entries.push({
      name,
      method,
      time,
      date,
      crc,
      compSize,
      rawSize,
      compressed: bytes.subarray(dataOff, dataOff + compSize),
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** Inflate one entry's bytes through the caller's codec. */
async function readEntry(entries, name, codec) {
  const e = entries.find((x) => x.name === name)
  if (!e) throw new Error(`entry not found: ${name}`)
  if (e.method === 0) return decoder.decode(e.compressed)
  if (e.method !== 8) throw new Error(`unsupported compression method ${e.method} for ${name}`)
  return decoder.decode(await codec.inflateRaw(e.compressed))
}

/** Replace one entry's content, re-deflating it. Everything else about the
    entry - its name, its position in the archive - is preserved. */
async function writeEntry(entries, name, text, codec) {
  const e = entries.find((x) => x.name === name)
  if (!e) throw new Error(`entry not found: ${name}`)
  const raw = utf8.encode(text)
  e.compressed = await codec.deflateRaw(raw)
  e.method = 8
  e.crc = crc32(raw)
  e.rawSize = raw.length
  e.compSize = e.compressed.length
}

/* --- write -------------------------------------------------------------- */

export function writeZip(entries) {
  const locals = []
  const central = []
  let offset = 0

  for (const e of entries) {
    const nameBuf = utf8.encode(e.name)

    const local = new Uint8Array(30 + nameBuf.length)
    const lv = view(local)
    lv.setUint32(0, LOCAL_SIG, true)
    lv.setUint16(4, 20, true) // version needed
    lv.setUint16(6, 0, true) // flags: no data descriptor, sizes are here
    lv.setUint16(8, e.method, true)
    lv.setUint16(10, e.time, true)
    lv.setUint16(12, e.date, true)
    lv.setUint32(14, e.crc, true)
    lv.setUint32(18, e.compSize, true)
    lv.setUint32(22, e.rawSize, true)
    lv.setUint16(26, nameBuf.length, true)
    lv.setUint16(28, 0, true) // no extra field
    local.set(nameBuf, 30)

    const cd = new Uint8Array(46 + nameBuf.length)
    const cv = view(cd)
    cv.setUint32(0, CENTRAL_SIG, true)
    cv.setUint16(4, 20, true) // version made by
    cv.setUint16(6, 20, true) // version needed
    cv.setUint16(8, 0, true)
    cv.setUint16(10, e.method, true)
    cv.setUint16(12, e.time, true)
    cv.setUint16(14, e.date, true)
    cv.setUint32(16, e.crc, true)
    cv.setUint32(20, e.compSize, true)
    cv.setUint32(24, e.rawSize, true)
    cv.setUint16(28, nameBuf.length, true)
    cv.setUint16(30, 0, true)
    cv.setUint16(32, 0, true)
    cv.setUint16(34, 0, true) // disk
    cv.setUint16(36, 0, true) // internal attrs
    cv.setUint32(38, 0, true) // external attrs
    cv.setUint32(42, offset, true)
    cd.set(nameBuf, 46)

    locals.push(local, e.compressed)
    central.push(cd)
    offset += local.length + e.compressed.length
  }

  const cdBuf = concat(central)
  const eocd = new Uint8Array(22)
  const ev = view(eocd)
  ev.setUint32(0, EOCD_SIG, true)
  ev.setUint16(4, 0, true)
  ev.setUint16(6, 0, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, cdBuf.length, true)
  ev.setUint32(16, offset, true)
  ev.setUint16(20, 0, true)

  return concat([...locals, cdBuf, eocd])
}

/* --- cell surgery ------------------------------------------------------- */

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

/** Find one cell element, whichever of the two forms it takes. */
function cellRegex(ref) {
  return new RegExp(`<c r="${ref}"((?:\\s[^>]*?)?)(?:/>|>([\\s\\S]*?)</c>)`)
}

function styleOf(match) {
  return /s="(\d+)"/.exec(match[1] ?? '')?.[0] ?? ''
}

function put(xml, ref, inner, extraAttr = '', { allowFormula = false } = {}) {
  const re = cellRegex(ref)
  const m = re.exec(xml)
  if (!m) throw new Error(`SF8 template has no cell ${ref}`)
  /* The guard that matters. A shared-formula master looks like an ordinary
     cell from here, and replacing one blanks every cell that depends on it. */
  if (!allowFormula && /<f[\s/>]/.test(m[2] ?? '')) {
    throw new Error(`refusing to overwrite formula cell ${ref}`)
  }
  const s = styleOf(m)
  const attrs = [`r="${ref}"`, s, extraAttr].filter(Boolean).join(' ')
  const replacement = inner === null ? `<c ${attrs}/>` : `<c ${attrs}>${inner}</c>`
  return xml.slice(0, m.index) + replacement + xml.slice(m.index + m[0].length)
}

const setNumber = (xml, ref, n) =>
  n === null || n === undefined || !Number.isFinite(n) ? put(xml, ref, null) : put(xml, ref, `<v>${n}</v>`)

const setText = (xml, ref, text) =>
  text === null || text === undefined || text === ''
    ? put(xml, ref, null)
    : put(xml, ref, `<is><t xml:space="preserve">${esc(text)}</t></is>`, 't="inlineStr"')

const setFormula = (xml, ref, formula) =>
  put(xml, ref, `<f>${esc(formula)}</f>`, '', { allowFormula: true })

const clear = (xml, ref) => put(xml, ref, null)

/* --- dates -------------------------------------------------------------- */

/** Excel's serial day number for an ISO date. Day 1 is 1900-01-01, and the
    epoch is shifted to 1899-12-30 to absorb Excel's fictional 1900 leap. */
export function excelSerial(iso) {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return null
  const ms = Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)
  return Math.round(ms / 86400000)
}

/* --- the export --------------------------------------------------------- */

/**
 * Type the job into a copy of the template and hand back the workbook bytes.
 *
 * @param {object}     args
 * @param {Uint8Array} args.template  the SF8 .xlsx, read by the caller
 * @param {object}     args.codec     { inflateRaw, deflateRaw }, both async,
 *                                    both Uint8Array in and out
 * @param {object}     args.job
 * @param {object}     args.job.header  schoolName, schoolId, district, division,
 *                                      region, grade, section, track, schoolYear,
 *                                      adviser
 * @param {string}     args.job.assessedOn  ISO date of the weigh-in
 * @param {Array}      args.job.males    [{ lrn, name, birthDate, weightKg, heightCm }]
 * @param {Array}      args.job.females  same shape
 * @returns {Promise<Uint8Array>}
 */
export async function buildSf8({ template, codec, job }) {
  const entries = readZip(template)
  let xml = await readEntry(entries, SHEET, codec)

  const h = job.header ?? {}
  xml = setText(xml, 'E5', h.schoolName)
  xml = setText(xml, 'I5', h.district)
  xml = setText(xml, 'L5', h.division)
  xml = setText(xml, 'O5', h.region)
  xml = h.schoolId ? setText(xml, 'C7', h.schoolId) : clear(xml, 'C7')
  xml = setText(xml, 'F7', h.grade)
  xml = setText(xml, 'H7', h.section)
  xml = setText(xml, 'L7', h.track ?? 'N/A')
  xml = setText(xml, 'O7', h.schoolYear)

  /* The date of assessment is not decoration: CalSheet reads it through the
     defined name `dateof` and every learner's age is measured from it. */
  xml = setNumber(xml, 'A124', excelSerial(job.assessedOn))
  /* "Conducted/Assessed By" is left blank for the assessor to sign or type
     in - the user's call (2026-10-08). It used to carry the class adviser. */
  xml = clear(xml, 'E124')
  // The certifying officers belong to whichever school signs this copy.
  xml = clear(xml, 'I124')
  xml = clear(xml, 'M124')

  // The two genuine gaps (see the note at the top of this file).
  xml = setFormula(xml, 'A12', 'IF(C12="","",ROWS($C$12:C12))')
  xml = setFormula(xml, 'K13', 'IF(J13="","",J13*J13)')

  const fill = (block, list) => {
    for (let i = 0; i < CAPACITY; i++) {
      const r = block.first + i
      const l = list[i]
      if (!l) {
        // Blank the inputs; the row's own formulas then evaluate to "".
        for (const col of ['B', 'C', 'G', 'I', 'J']) xml = clear(xml, `${col}${r}`)
        continue
      }
      // LRN as text: it is an identifier, and twelve digits in a numeric cell
      // is one column-width away from being shown as 1.36E+11.
      xml = setText(xml, `B${r}`, l.lrn)
      xml = setText(xml, `C${r}`, l.name)
      xml = setNumber(xml, `G${r}`, excelSerial(l.birthDate))
      xml = setNumber(xml, `I${r}`, l.weightKg)
      /* The form works in metres; we store centimetres. Written at full
         precision rather than rounded to the two decimals the column shows,
         so the BMI this sheet computes is the same number CHAS computed from
         the same measurement. Rounding here to 1.29 would have made the
         screen and the paper disagree in the last digit, which is the one
         thing this export exists to prevent. */
      xml = setNumber(xml, `J${r}`, Number.isFinite(l.heightCm) ? l.heightCm / 100 : null)
    }
  }

  fill(MALE_ROWS, job.males ?? [])
  fill(FEMALE_ROWS, job.females ?? [])

  await writeEntry(entries, SHEET, xml, codec)

  /* Formula results cached by Excel the last time the template was saved are
     now stale - they describe the previous school's learner. Telling Excel to
     recalculate the whole book on open is what makes the file correct the
     moment it is opened, without us computing anything ourselves. */
  let wb = await readEntry(entries, WORKBOOK, codec)
  if (/<calcPr\b[^>]*\/>/.test(wb)) {
    wb = wb.replace(/<calcPr\b([^>]*?)\/>/, (m0, a) =>
      /fullCalcOnLoad/.test(a) ? m0 : `<calcPr${a} fullCalcOnLoad="1"/>`,
    )
  } else {
    wb = wb.replace('</workbook>', '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>')
  }
  await writeEntry(entries, WORKBOOK, wb, codec)

  await dropHelperSheet(entries, codec)

  return writeZip(entries)
}

/* --- reading the form back out --------------------------------------------

   The PDF export does not hand anyone the workbook. It draws the form and
   fills in what the workbook's formulas would have computed - so it needs
   the two things those formulas read: DepEd's per-month cut-off tables, and
   the two pictures in the form's header. Both come out of the same template
   file, read here, so the PDF bands a learner against exactly the numbers the
   workbook would have used.

   The tables are the workbook's defined names, kept as found:

     BMI     'BMI Tables'!$A$4:$R$172   key, months, then boys' cut-offs in
                                        columns 3-10 and girls' in 11-18
     HEIGHT  'BMI Tables'!$T$4:$AG$172  key, months, then boys' cut-offs in
                                        columns 3-8 and girls' in 9-14

   The key is age as the form writes it - years, a point, two-digit months -
   so 8 years 4 months is 8.04 and 8 years 10 months is 8.1. Each row is
   returned as an array indexed like VLOOKUP's column argument minus one. */

const TABLE_SHEET = 'xl/worksheets/sheet5.xml'
const TABLE_ROWS = { first: 4, last: 172 }
const BMI_COLS = colRange('A', 'R')
const HEIGHT_COLS = colRange('T', 'AG')

/** The DepEd seal (top left) and the DepEd wordmark (top right), as the
    form's own drawing places them. */
const SEAL = 'xl/media/image1.jpg'
const WORDMARK = 'xl/media/image3.jpg'

function colIndex(letters) {
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

function colRange(from, to) {
  const out = []
  for (let n = colIndex(from); n <= colIndex(to); n++) {
    let s = ''
    for (let m = n; m > 0; m = Math.floor((m - 1) / 26)) s = String.fromCharCode(65 + ((m - 1) % 26)) + s
    out.push(s)
  }
  return out
}

/** Raw bytes of one entry, inflated if it was stored compressed. */
async function readBytes(entries, name, codec) {
  const e = entries.find((x) => x.name === name)
  if (!e) throw new Error(`entry not found: ${name}`)
  if (e.method === 0) return e.compressed.slice()
  if (e.method !== 8) throw new Error(`unsupported compression method ${e.method} for ${name}`)
  return codec.inflateRaw(e.compressed)
}

/**
 * The cut-off tables and header pictures the PDF export needs.
 *
 * @param {object}     args
 * @param {Uint8Array} args.template  the SF8 .xlsx
 * @param {object}     args.codec     { inflateRaw }, async, Uint8Array in and out
 * @returns {Promise<{ bmi: number[][], height: number[][], seal: Uint8Array, wordmark: Uint8Array }>}
 */
export async function readSf8Form({ template, codec }) {
  const entries = readZip(template)
  const xml = await readEntry(entries, TABLE_SHEET, codec)

  /* Every value cell in the table rows, by reference. A formula cell carries
     its last computed value in <v> as well, which is the number Excel shows. */
  const values = new Map()
  for (const m of xml.matchAll(/<c r="([A-Z]+)(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const row = Number(m[2])
    if (row < TABLE_ROWS.first || row > TABLE_ROWS.last) continue
    const v = /<v>([^<]*)<\/v>/.exec(m[3] ?? '')
    if (v) values.set(`${m[1]}${row}`, Number(v[1]))
  }

  const table = (cols) => {
    const rows = []
    for (let r = TABLE_ROWS.first; r <= TABLE_ROWS.last; r++) {
      const row = cols.map((c) => values.get(`${c}${r}`))
      if (row.some((n) => n === undefined || !Number.isFinite(n))) {
        throw new Error(`SF8 template table is incomplete at row ${r}`)
      }
      rows.push(row)
    }
    return rows
  }

  return {
    bmi: table(BMI_COLS),
    height: table(HEIGHT_COLS),
    seal: await readBytes(entries, SEAL, codec),
    wordmark: await readBytes(entries, WORDMARK, codec),
  }
}

/* --- the helper sheet ------------------------------------------------------

   The template's first tab, "Sir Wedz Helper Tables", is the form author's
   own reference page. Nothing in the workbook reads it - no formula, no
   defined name, no other sheet - so it is taken out of every export (the
   user's call, 2026-10-08) rather than handed to the school as a stray tab.

   Removing a sheet from an .xlsx means removing it from every index that
   names it, not just deleting its XML:

     - workbook.xml        its <sheet> element, and activeTab, which counts
                           tabs and would otherwise point one past the form
     - workbook.xml.rels   its relationship, and the calc chain's
     - [Content_Types]     the overrides for the parts that go
     - docProps/app.xml    the tab count and its title
     - the parts           the sheet, its rels, its drawing and the one
                           picture only that drawing uses

   The calc chain is dropped rather than edited: it lists formula cells by
   sheet index, every index after the removed sheet shifts, and Excel
   rebuilds the chain itself on open (fullCalcOnLoad is already set). */

const HELPER = {
  name: 'Sir Wedz Helper Tables',
  sheet: 'xl/worksheets/sheet1.xml',
  sheetRels: 'xl/worksheets/_rels/sheet1.xml.rels',
  drawing: 'xl/drawings/drawing1.xml',
  drawingRels: 'xl/drawings/_rels/drawing1.xml.rels',
}

async function dropHelperSheet(entries, codec) {
  const has = (n) => entries.some((e) => e.name === n)
  let wb = await readEntry(entries, WORKBOOK, codec)
  const sheetTag = new RegExp(`<sheet name="${HELPER.name}"[^>]*?r:id="([^"]+)"[^>]*/>`)
  const m = sheetTag.exec(wb)
  // A template that no longer carries the tab: nothing to do.
  if (!m) return
  const relId = m[1]
  const tabIndex = [...wb.matchAll(/<sheet\b[^>]*\/>/g)].findIndex((x) => x[0] === m[0])

  wb = wb.replace(m[0], '')
  wb = wb.replace(/activeTab="(\d+)"/, (all, n) => {
    const t = Number(n)
    return `activeTab="${t > tabIndex ? t - 1 : t === tabIndex ? 0 : t}"`
  })
  await writeEntry(entries, WORKBOOK, wb, codec)

  // Pictures the helper's drawing uses that no other drawing does.
  const targets = (rels) => [...rels.matchAll(/Target="\.\.\/media\/([^"]+)"/g)].map((x) => `xl/media/${x[1]}`)
  const mine = has(HELPER.drawingRels) ? targets(await readEntry(entries, HELPER.drawingRels, codec)) : []
  const others = []
  for (const e of entries) {
    if (/^xl\/drawings\/_rels\/.+\.rels$/.test(e.name) && e.name !== HELPER.drawingRels) {
      others.push(...targets(await readEntry(entries, e.name, codec)))
    }
  }
  const media = mine.filter((p) => !others.includes(p))

  let rels = await readEntry(entries, 'xl/_rels/workbook.xml.rels', codec)
  rels = rels.replace(new RegExp(`<Relationship Id="${relId}"[^>]*/>`), '')
  rels = rels.replace(/<Relationship [^>]*Target="calcChain\.xml"[^>]*\/>/, '')
  await writeEntry(entries, 'xl/_rels/workbook.xml.rels', rels, codec)

  const gone = [HELPER.sheet, HELPER.sheetRels, HELPER.drawing, HELPER.drawingRels, 'xl/calcChain.xml', ...media]
  let types = await readEntry(entries, '[Content_Types].xml', codec)
  for (const part of gone) types = types.replace(new RegExp(`<Override PartName="/${part.replace(/\./g, '\\.')}"[^>]*/>`), '')
  await writeEntry(entries, '[Content_Types].xml', types, codec)

  if (has('docProps/app.xml')) {
    let app = await readEntry(entries, 'docProps/app.xml', codec)
    app = app
      .replace(/(<vt:lpstr>Worksheets<\/vt:lpstr><\/vt:variant><vt:variant><vt:i4>)(\d+)(<\/vt:i4>)/, (a, p, n, s) => `${p}${Number(n) - 1}${s}`)
      .replace(`<vt:lpstr>${HELPER.name}</vt:lpstr>`, '')
      .replace(/(<TitlesOfParts><vt:vector size=")(\d+)/, (a, p, n) => `${p}${Number(n) - 1}`)
    await writeEntry(entries, 'docProps/app.xml', app, codec)
  }

  for (const part of gone) {
    const i = entries.findIndex((e) => e.name === part)
    if (i >= 0) entries.splice(i, 1)
  }
}
