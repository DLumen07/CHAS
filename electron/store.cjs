/* Local record store.

   A single JSON file in Electron's per-user data directory. Not SQLite yet,
   and deliberately not: the pre-test needs measurements to survive a restart,
   and a native module that has to be rebuilt against Electron's ABI is a poor
   thing to be debugging the week of a school visit. The shape written here is
   the same shape a table would hold, so the move to SQLCipher is a migration
   rather than a redesign.

   Writes are atomic: content goes to a temp file in the same directory and is
   then renamed over the target. A half-written JSON file after a power cut on
   a school workstation would lose the whole weigh-in, and rename on the same
   volume is the closest thing to a commit available here.

   NOT YET ENCRYPTED. The file sits in the user profile in plain text. The
   passphrase on the sign-in screen currently unlocks nothing. Anyone claiming
   otherwise in a defence would be wrong. Encryption at rest arrives with the
   key derivation, not before.
*/

const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const FILE = () => path.join(app.getPath('userData'), 'chas-records.json')

/* The current shape. Bump this and the copy in src/lib/records.ts together;
   they are the same file seen from two processes.

     1 -> 2  slips gained 'attended' in place of 'returned'
     2 -> 3  immunizations added; install gained a role
     3 -> 4  staff role overrides and school announcements added */
const VERSION = 4

const EMPTY = {
  version: VERSION,
  savedAt: null,
  // learnerId -> measurement record
  measurements: {},
  // learnerId -> absence record, for learners who were not on the scale
  absences: {},
  // learnerId -> immunization card status, as the school last saw it
  immunizations: {},
  // learnerId -> slip state, incl. the meeting the slip was printed for
  slips: {},
  // the meeting the next batch of slips will name, or null
  meeting: null,
  // the follow-up weigh-in in progress, or null (added 2026-10-11)
  followUp: null,
  // whose install this is: { adviser, section, role }, or null until claimed
  install: null,
  // staffId -> { name?, role, section, active, updatedAt, by }
  staff: {},
  // school notices, newest first
  announcements: [],
}

/* Every map the renderer expects is filled in here, whatever the file on disk
   happens to contain. A file written by an older build is missing whichever
   maps were added since, and handing the renderer an object with a missing
   key crashes it to a blank window on the first render after sign-in. Add a
   map to the renderer, add it here in the same commit. */
function load() {
  const file = FILE()
  try {
    if (!fs.existsSync(file)) return { ...EMPTY }
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    return {
      ...EMPTY,
      ...parsed,
      measurements: parsed.measurements ?? {},
      absences: parsed.absences ?? {},
      immunizations: parsed.immunizations ?? {},
      slips: parsed.slips ?? {},
      /* Null is a real value here - "no meeting set" - so it is defaulted
         only when the key is absent, never when it is explicitly null. */
      meeting: parsed.meeting ?? null,
      followUp: parsed.followUp ?? null,
      install: parsed.install ?? null,
      staff: parsed.staff ?? {},
      announcements: Array.isArray(parsed.announcements) ? parsed.announcements : [],
    }
  } catch (err) {
    /* A corrupt file must not take the app down and must not be silently
       overwritten either: the nurse's morning of work might be in it. Move it
       aside with a timestamp so it can be recovered by hand. */
    try {
      const bad = `${file}.corrupt-${Date.now()}`
      fs.renameSync(file, bad)
      console.error(`[chas] unreadable record file moved to ${bad}:`, err.message)
    } catch (renameErr) {
      console.error('[chas] could not quarantine the record file:', renameErr.message)
    }
    return { ...EMPTY }
  }
}

function save(data) {
  const file = FILE()
  const tmp = `${file}.tmp`
  /* The version written is this module's own, not the renderer's and not
     whatever was in the file. It was hardcoded to 1 here, which meant every
     save stamped version-2 content with the version-1 number - a file that
     lied about its own shape, and a migration that would have read it wrong
     the first time one was written against the stamp rather than against the
     keys. */
  const payload = JSON.stringify({
    ...data,
    version: VERSION,
    savedAt: new Date().toISOString(),
  })
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(tmp, payload, 'utf8')
  fs.renameSync(tmp, file)
  return { ok: true, path: file }
}

module.exports = { load, save, FILE }
