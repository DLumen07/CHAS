/* Extract WHO 2007 LMS parameters from the official expanded xlsx tables.

   The two indicators do NOT share a column layout, which is the whole reason
   this reads the header row instead of hardcoding letters:

     BMI-for-age: Month L M S SD4neg SD3neg SD2neg SD1neg SD0 SD1 SD2 SD3 SD4
     Height-for-age: Month L M S StDev SD5neg SD4neg SD3neg SD2neg SD1neg SD0
                     SD1 SD2 SD3 SD4

   Height-for-age carries two extra columns (StDev, SD5neg), so any fixed
   letter mapping that works for BMI is silently wrong by two columns for
   height, and produces plausible-looking but incorrect z-scores.

   We keep Month, L, M, S and then VERIFY by reconstructing WHO's own
   published SD columns from those parameters: value(z) = M*(1 + L*S*z)^(1/L)
   must reproduce SD3neg..SD3 to WHO's own rounding. Any mismatch means we
   misread the file, and the script refuses to emit rather than ship numbers
   that would misclassify a child.
*/

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SRC = process.argv[2]
const OUT = process.argv[3]

const FILES = [
  { path: 'bmi-boys.xlsx', indicator: 'bfa', sex: 'M' },
  { path: 'bmi-girls.xlsx', indicator: 'bfa', sex: 'F' },
  { path: 'hfa-boys.xlsx', indicator: 'hfa', sex: 'M' },
  { path: 'hfa-girls.xlsx', indicator: 'hfa', sex: 'F' },
]

function readSheet(xlsxPath) {
  const dir = mkdtempSync(join(tmpdir(), 'who-'))
  execSync(`unzip -o -q "${xlsxPath}" -d "${dir}"`)
  const sheet = readFileSync(join(dir, 'xl', 'worksheets', 'sheet1.xml'), 'utf8')
  const sharedXml = readFileSync(join(dir, 'xl', 'sharedStrings.xml'), 'utf8')

  const shared = [...sharedXml.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => m[1])

  const rawRows = []
  for (const rm of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = {}
    for (const cm of rm[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*)>(?:<v>([^<]*)<\/v>)?/g)) {
      const [, col, attrs, val] = cm
      if (val === undefined) continue
      // t="s" means the value is an index into sharedStrings, not a number.
      cells[col] = /\bt="s"/.test(attrs) ? shared[Number(val)] : Number(val)
    }
    rawRows.push(cells)
  }

  // Column letter -> header name, taken from the first row that names "Month".
  const headerRow = rawRows.find((r) => Object.values(r).includes('Month'))
  if (!headerRow) throw new Error(`${xlsxPath}: no header row found`)
  const colOf = {}
  for (const [col, name] of Object.entries(headerRow)) colOf[name] = col

  for (const need of ['Month', 'L', 'M', 'S']) {
    if (!colOf[need]) throw new Error(`${xlsxPath}: missing column "${need}"`)
  }

  const rows = []
  for (const r of rawRows) {
    if (r === headerRow) continue
    const month = r[colOf.Month]
    if (typeof month !== 'number' || month < 61) continue
    const named = {}
    for (const [name, col] of Object.entries(colOf)) named[name] = r[col]
    rows.push(named)
  }
  return { rows, headers: Object.keys(colOf) }
}

/** WHO LMS: the measurement value at a given z. */
function valueAtZ(L, M, S, z) {
  return L === 0 ? M * Math.exp(S * z) : M * Math.pow(1 + L * S * z, 1 / L)
}

const out = { bfa: { M: [], F: [] }, hfa: { M: [], F: [] } }
let checked = 0
let worst = 0
let worstAt = null

for (const f of FILES) {
  const { rows, headers } = readSheet(join(SRC, f.path))
  if (rows.length < 150) throw new Error(`${f.path}: only ${rows.length} data rows`)

  for (const r of rows) {
    const { Month: month, L, M, S } = r

    // Reconstruct WHO's own published SD columns from the L, M, S we parsed.
    for (const z of [-3, -2, -1, 0, 1, 2, 3]) {
      const key = z === 0 ? 'SD0' : z < 0 ? `SD${-z}neg` : `SD${z}`
      const published = r[key]
      if (typeof published !== 'number') continue
      const diff = Math.abs(valueAtZ(L, M, S, z) - published)
      checked++
      if (diff > worst) {
        worst = diff
        worstAt = `${f.indicator} ${f.sex} month ${month} z ${z}: ours ${valueAtZ(L, M, S, z).toFixed(4)} vs WHO ${published}`
      }
    }
    out[f.indicator][f.sex].push([month, L, M, S])
  }
  console.log(
    `${f.path.padEnd(16)} ${String(rows.length).padStart(3)} rows, months ` +
      `${rows[0].Month}-${rows[rows.length - 1].Month}, cols: ${headers.join(' ')}`,
  )
}

console.log(`\nVerified ${checked} reconstructed values against WHO's published SD columns.`)
console.log(`Largest disagreement: ${worst.toFixed(6)}`)
if (worstAt) console.log(`  worst case -> ${worstAt}`)

// WHO rounds the published SD columns to 3-4 decimals, so a correct parse
// lands within rounding distance. Anything larger is a column mapping bug.
if (worst > 0.005) {
  throw new Error(`Reconstruction disagrees with WHO by ${worst}. Refusing to emit.`)
}

writeFileSync(
  OUT,
  JSON.stringify({
    source: 'WHO Growth reference data for 5-19 years (2007), expanded z-score tables',
    urls: [
      'https://www.who.int/tools/growth-reference-data-for-5to19-years/indicators/bmi-for-age',
      'https://www.who.int/tools/growth-reference-data-for-5to19-years/indicators/height-for-age',
    ],
    retrieved: '2026-09-04',
    note: 'Rows are [ageInMonths, L, M, S]. bfa = BMI-for-age, hfa = height-for-age.',
    verification: {
      valuesChecked: checked,
      largestDeviationFromPublishedSD: Number(worst.toFixed(6)),
    },
    bfa: out.bfa,
    hfa: out.hfa,
  }),
)
console.log(`\nWrote ${OUT}`)
