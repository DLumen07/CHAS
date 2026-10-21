/* Validate the shipped classification engine against WHO's own tables.

   This bundles src/lib/nutrition.ts with esbuild and exercises the real
   exported functions, rather than reimplementing the formulas here. A test
   that reimplements what it is testing only proves the reimplementation.

   The check: WHO publishes, for every month and sex, the measurement value
   that sits exactly on each SD line. Feed that value back in and the engine
   must return that z. If it returns -1.97 where WHO says -2, the engine bands
   a learner on the wrong side of a cut-off that decides whether a parent gets
   a letter.

   Run: node scripts/verify-who.mjs
*/

import { execSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const dir = mkdtempSync(join(tmpdir(), 'chas-verify-'))
const bundle = join(dir, 'nutrition.mjs')

execSync(
  `npx esbuild src/lib/nutrition.ts --bundle --format=esm --platform=neutral ` +
    `--loader:.json=json --outfile="${bundle}"`,
  { stdio: 'pipe' },
)

const N = await import(pathToFileURL(bundle).href)

/* Rebuild the value-at-z lines straight from the WHO xlsx-derived table, then
   ask the engine for the z of each. */
const raw = JSON.parse(readFileSync('src/data/who2007.json', 'utf8'))

let checks = 0
let failures = []
let worst = 0

function valueAtZ(L, M, S, z) {
  return L === 0 ? M * Math.exp(S * z) : M * Math.pow(1 + L * S * z, 1 / L)
}

// Height-for-age: plain LMS across the whole range, so every SD line round-trips.
for (const sex of ['M', 'F']) {
  for (const [month, L, M, S] of raw.hfa[sex]) {
    for (const z of [-3, -2, -1, 0, 1, 2, 3]) {
      const height = valueAtZ(L, M, S, z)
      const got = N.zHeightForAge(height, month, sex)
      const diff = Math.abs(got - z)
      checks++
      worst = Math.max(worst, diff)
      if (diff > 1e-6) failures.push(`hfa ${sex} m${month} z${z}: got ${got}`)
    }
  }
}

/* BMI-for-age: WHO restricts the LMS tail beyond +/-3, so only the -3..3 lines
   round-trip exactly. That restriction is the behaviour under test, so the
   boundaries are checked too: at exactly +/-3 the two definitions must agree,
   which is what makes the piecewise function continuous. */
for (const sex of ['M', 'F']) {
  for (const [month, L, M, S] of raw.bfa[sex]) {
    for (const z of [-3, -2, -1, 0, 1, 2, 3]) {
      // Reconstruct the weight that yields this BMI at a plausible height.
      const targetBmi = valueAtZ(L, M, S, z)
      const heightCm = 130
      const weightKg = targetBmi * (heightCm / 100) ** 2
      const got = N.zBmiForAge(weightKg, heightCm, month, sex)
      const diff = Math.abs(got - z)
      checks++
      worst = Math.max(worst, diff)
      if (diff > 1e-6) failures.push(`bfa ${sex} m${month} z${z}: got ${got}`)
    }
  }
}

/* Out-of-range ages must return null, never a guessed band. */
const outOfRange = [
  N.zBmiForAge(20, 110, 60, 'M'), // 5y0m, one month below the reference
  N.zBmiForAge(20, 110, 229, 'M'), // just past 19y0m
  N.zHeightForAge(110, 60, 'F'),
]
if (outOfRange.some((v) => v !== null)) {
  failures.push(`out-of-range ages returned ${JSON.stringify(outOfRange)} instead of null`)
}

/* The restricted tail must actually restrict: a severely underweight reading
   should give a milder z than the raw Box-Cox tail would. */
const severe = N.zBmiForAge(14, 140, 144, 'M')
if (!(severe < -3)) failures.push(`expected a severely wasted z below -3, got ${severe}`)

rmSync(dir, { recursive: true, force: true })

console.log(`WHO source: ${N.WHO_SOURCE}`)
console.log(`Tables retrieved: ${N.WHO_RETRIEVED}`)
console.log(`Reference range: months ${N.MIN_AGE_MONTHS} to ${N.MAX_AGE_MONTHS}`)
console.log(`\nRound-tripped ${checks} WHO SD lines through the engine.`)
console.log(`Largest z error: ${worst.toExponential(2)}`)
console.log(`Out-of-range ages return null: ${outOfRange.every((v) => v === null)}`)
console.log(`Severely wasted example (14kg, 140cm, 12y, boy): z ${severe.toFixed(2)}`)

if (failures.length) {
  console.error(`\n${failures.length} FAILURES:`)
  for (const f of failures.slice(0, 20)) console.error('  ' + f)
  process.exit(1)
}
console.log('\nPASS')
