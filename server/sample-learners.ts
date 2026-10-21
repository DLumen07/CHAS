/* Add the twenty-five sample learners in samples.ts to this computer's CHAS.

   Run with `npm run seed:samples` from the project root. It opens the same
   database the installed CHAS uses (%APPDATA%\CHAS\database; set
   CHAS_DATA_DIR to use another folder), creating it first if this computer has
   never run the new CHAS, adds the learners, and closes it again. CHAS itself
   must be closed while it runs: two programs cannot open one database.

   Safe to run twice: a learner whose LRN is already there is skipped. Do not
   run this on a computer holding a real school's records. */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startDesktop } from './desktop.js'
import { SAMPLES, addSampleLearners } from './samples.js'

async function main() {
  const dataDir =
    process.env.CHAS_DATA_DIR ||
    path.join(process.env.APPDATA ?? path.join(process.env.HOME ?? '.', 'AppData', 'Roaming'), 'CHAS', 'database')
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

  console.log(`Opening the CHAS database in ${dataDir}`)
  const desktop = await startDesktop({
    dataDir,
    appDir: path.join(root, 'dist'),
    migrationsDir: path.join(root, 'server', 'prisma', 'migrations'),
    log: () => {},
  })

  try {
    const added = await addSampleLearners(console.log)
    console.log(`Done: ${added} added, ${SAMPLES.length - added} already there.`)
  } finally {
    await desktop.stop()
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(`Could not add the sample learners: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  },
)
