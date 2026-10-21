/* The saved record layer.

   The generated roster in `data/mock.ts` is the base list of learners. What
   the nurse actually types is stored separately, keyed by learner id, and
   merged over that base. Keeping the two apart means a roster import later
   replaces the base without touching a single recorded measurement.

   THREE backends now, and the third is the one that matters. See
   SERVER_BACKED in ./backend.ts: when the app is built against an
   API, the store below is not used at all and lib/server-records.ts answers
   instead. What follows is the LOCAL store, which is still what
   `dev:renderer` and the offline desktop build run on.

   Local backends:
     - Electron: a JSON file in the per-user data directory, through the
       `chas:records:*` IPC channels. This is the one that matters.
     - A plain browser (`npm run dev:renderer`): localStorage, so the screens
       can be worked on without launching Electron. Never used in the packaged
       app.

   NOT ENCRYPTED YET. See electron/store.cjs.
*/

import { useEffect, useSyncExternalStore } from 'react'
import {
  LEARNERS,
  type ImmunizationStatus,
  type Learner,
  type SlipState,
} from '../data/mock'
import { assess } from './nutrition'
import { useServerRoster } from './server-records'
import { SERVER_BACKED } from './backend'

export interface MeasurementRecord {
  heightCm: number
  weightKg: number
  measuredOn: string
  /** Who recorded it. One account for now, but the field exists so the audit
      trail has something real to write when accounts do. */
  by: string
  /** When the keystroke happened, to the second.

      `measuredOn` is the date the weigh-in belongs to, which the nurse can
      set to a past session; this is when the row was actually written, and
      it is what the dashboard's activity feed orders by. Optional because
      files written before it existed have no answer, and inventing one
      would put a made-up time on a real record. */
  at?: string
}

/** A learner who was not on the scale that day. Stored, not thrown away: the
    queue has to skip them again after a restart, and "absent" is a different
    fact from "not yet measured". It is deliberately NOT a measurement of
    zero, which would put a 0cm learner in the roster. */
export interface AbsenceRecord {
  measuredOn: string
  by: string
  /** When it was marked - see MeasurementRecord.at. */
  at?: string
}

/** The learner's immunization card, as the school last saw it.

    Stored beside the measurements rather than on them because it changes on
    a different clock: a card is checked once and then not again for a year,
    while a child is weighed every term. It carries who looked and when, so
    "up to date" on the admin screen can always be traced to somebody having
    actually opened the card. */
export interface ImmunizationRecord {
  status: ImmunizationStatus
  /** The date the card was checked. */
  checkedOn: string
  by: string
  /** When the row was written - see MeasurementRecord.at. */
  at?: string
}

/** When and where the parents of flagged learners are asked to come. One
    current setting that the slips screen edits, plus a frozen copy stamped
    onto each slip at print time - the paper in a parent's hand names a
    specific date, and changing next month's meeting must not silently
    rewrite what last month's slip said. */
/** An extra weigh-in for a chosen set of learners, between the baseline and
    the endline (2026-10-11). A learner is done for it once measured on or
    after `startedOn`. One is open at a time. */
export interface FollowUp {
  id: string
  label: string
  startedOn: string
  learnerIds: string[]
}

export interface Meeting {
  date: string
  time: string
  venue: string
}

/** Whose laptop this is: the school head's or the school nurse's. Both read
    the whole school. Set once, on first sign-in, and kept in the records file
    so the laptop stays theirs across restarts. Null means the install has not
    been claimed yet, which is the only state that sends the user back to
    sign-in.

    There is no class-adviser install any more. A file claimed by an adviser
    (or written before roles existed, when every install was an adviser's) is
    read as unclaimed - see `normaliseInstall`. */
export type Role = 'admin' | 'nurse'

export interface Install {
  /** The person signed in, named the way a DepEd form names them. The key is
      `adviser` for historical reasons: it is persisted in the records file,
      and renaming it would unclaim every existing install. */
  adviser: string
  /** Always empty: both roles read every section. Kept so files written by
      earlier builds still parse. */
  section: string
  role: Role
}

/** A persisted install, or null if it was claimed for a role that no longer
    exists. Anything that is not the head's or the nurse's goes back to
    sign-in rather than being guessed at. */
function normaliseInstall(raw: unknown): Install | null {
  const i = raw as Partial<Install> | null | undefined
  if (!i || (i.role !== 'admin' && i.role !== 'nurse')) return null
  return { adviser: i.adviser ?? '', section: '', role: i.role }
}

/** The role of an install. */
export function roleOf(install: Install | null | undefined): Role | null {
  return install?.role ?? null
}

export function isAdmin(install: Install | null | undefined): boolean {
  return roleOf(install) === 'admin'
}

/** The server's Role enum, in this file's vocabulary.

    One function rather than a ternary at each call site. There were two of
    those - the sign-in handler and the boot-time /me. An unknown value reads
    as null, and the caller refuses the sign-in rather than guessing. */
export function roleFromServer(role: string): Role | null {
  if (role === 'ADMIN') return 'admin'
  if (role === 'NURSE') return 'nurse'
  return null
}

/** The school nurse. Reads every section, manages none of the school. */
export function isNurse(install: Install | null | undefined): boolean {
  return roleOf(install) === 'nurse'
}

export interface SlipRecord {
  slip: SlipState
  printedAt: string | null
  attendedAt: string | null
  /** The meeting this particular slip was printed for. */
  meeting: Meeting | null
}

/** What the school head has decided about one staff account.

    Stored as an OVERRIDE, not as the account itself, for the same reason a
    measurement is stored apart from the learner: `data/mock.ts` already names
    the head and the nurse, and that list is what a roster import will one
    day replace. Writing a full copy of every account into the record file
    would mean an import silently disagreeing with rows nobody remembers
    editing.

    `name` is present only on accounts created here, which have no baseline
    row to sit over. Everything else is a change to a baseline row. */
export interface StaffRecord {
  /** Set only on an account added on this workstation. */
  name?: string
  role: Role
  /** A revoked account keeps its history and stops being offered at sign-in.
      Deleting it would orphan every audit line that names it. */
  active: boolean
  updatedAt: string
  by: string
}

/** Who an announcement is written for. It changes nothing about who can read
    the screen - one workstation, one signed-in person - and everything about
    what the notice is expected to say, so it is a label the head chooses
    rather than a permission the app enforces. */
export type Audience = 'staff' | 'parents'

export interface Announcement {
  id: string
  title: string
  body: string
  audience: Audience
  /** ISO timestamp. Newest first everywhere it is listed. */
  postedAt: string
  by: string
  /** Held at the top of the list until it is unpinned. */
  pinned: boolean
}

export interface RecordsFile {
  version: number
  savedAt: string | null
  measurements: Record<string, MeasurementRecord>
  absences: Record<string, AbsenceRecord>
  immunizations: Record<string, ImmunizationRecord>
  slips: Record<string, SlipRecord>
  /** The meeting the next batch of slips will name. */
  meeting: Meeting | null
  /** The follow-up weigh-in in progress, or null. Added 2026-10-11; read as
      null from older files. */
  followUp: FollowUp | null
  /** Whose laptop this is. */
  install: Install | null
  /** Staff account changes, keyed by the account id the Roles screen derives
      from the section list. Added in version 4. */
  staff: Record<string, StaffRecord>
  /** School notices, newest first. Added in version 4. The notices screen
      was removed; the field stays so files and backups that carry notices
      keep them rather than having them silently dropped. */
  announcements: Announcement[]
}

const EMPTY: RecordsFile = {
  version: 4,
  savedAt: null,
  measurements: {},
  absences: {},
  immunizations: {},
  slips: {},
  meeting: null,
  followUp: null,
  install: null,
  staff: {},
  announcements: [],
}

const LS_KEY = 'chas:records'

interface Bridge {
  records?: {
    load: () => Promise<RecordsFile>
    save: (d: RecordsFile) => Promise<{ ok: boolean; path: string }>
    path: () => Promise<string>
  }
}
const bridge = (): Bridge['records'] | undefined =>
  (window as unknown as { chas?: Bridge }).chas?.records

/* Whatever comes back from either backend is treated as untrusted shape.

   A file written by an older build is missing whichever maps have been added
   since, and reading `Object.keys(undefined)` during the first render after
   sign-in takes the whole window to blank. That happened once, because
   `absences` was added here and not to electron/store.cjs. Normalising on the
   way in means only this function has to be right. */
/** A version-1 slip, as written by builds where the slip was an advisory
    to acknowledge rather than an invitation to attend. */
interface LegacySlipRecord {
  slip: SlipState | 'returned'
  printedAt: string | null
  returnedAt?: string | null
  attendedAt?: string | null
  meeting?: Meeting | null
}

function normalise(raw: Partial<RecordsFile> | null | undefined): RecordsFile {
  /* Version 1 files carry 'returned' / returnedAt. A returned stub was the
     nearest thing that build recorded to a parent responding, so it is read
     forward as attendance rather than dropped - a school that has been using
     the app does not lose its slip history to a rename. Nothing is written
     back in the old shape; the next save is version 2. */
  const slips: Record<string, SlipRecord> = {}
  for (const [id, rec] of Object.entries(
    (raw?.slips ?? {}) as Record<string, LegacySlipRecord>,
  )) {
    if (!rec) continue
    slips[id] = {
      slip: rec.slip === 'returned' ? 'attended' : rec.slip,
      printedAt: rec.printedAt ?? null,
      attendedAt: rec.attendedAt ?? rec.returnedAt ?? null,
      meeting: rec.meeting ?? null,
    }
  }

  return {
    version: 4,
    savedAt: raw?.savedAt ?? null,
    measurements: raw?.measurements ?? {},
    absences: raw?.absences ?? {},
    /* Added in version 3. A file from either earlier version has no such map,
       and the rule that has already cost this app one blank window is that a
       map the renderer reads must be filled in here, never assumed. */
    immunizations: raw?.immunizations ?? {},
    slips,
    meeting: raw?.meeting ?? null,
    followUp: raw?.followUp ?? null,
    install: normaliseInstall(raw?.install),
    /* Added in version 4, and defaulted here for the same reason the maps
       above are: a file written by any earlier build has neither key, and the
       Roles screen reads the map on its first render. */
    staff: raw?.staff ?? {},
    /* Notices addressed to the class advisers, from before that role was
       removed, are read as addressed to the staff. */
    announcements: Array.isArray(raw?.announcements)
      ? raw.announcements.map((a) =>
          (a.audience as string) === 'advisers' ? { ...a, audience: 'staff' as const } : a,
        )
      : [],
  }
}

export async function loadRecords(): Promise<RecordsFile> {
  const b = bridge()
  if (b) {
    try {
      return normalise(await b.load())
    } catch (err) {
      console.error('[chas] could not load records from disk', err)
      return normalise(null)
    }
  }
  try {
    const raw = localStorage.getItem(LS_KEY)
    return normalise(raw ? JSON.parse(raw) : null)
  } catch {
    return normalise(null)
  }
}

export async function saveRecords(data: RecordsFile): Promise<void> {
  const b = bridge()
  if (b) {
    await b.save(data)
    return
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ ...data, savedAt: new Date().toISOString() }))
  } catch (err) {
    console.error('[chas] could not save records', err)
  }
}

export function storageLabel(): string {
  return bridge() ? 'Saved to this computer' : 'Saved in this browser (development only)'
}

/** Merge one saved measurement over a base learner, recomputing the bands
    from the stored height and weight rather than trusting anything cached. */
function applyRecord(base: Learner, rec: MeasurementRecord | undefined): Learner {
  if (!rec) return base
  const a = assess(rec.weightKg, rec.heightCm, base.birthDate, rec.measuredOn, base.sex)
  return {
    ...base,
    heightCm: rec.heightCm,
    weightKg: rec.weightKg,
    measuredOn: rec.measuredOn,
    bmiZ: a.bmiZ === null ? null : Number(a.bmiZ.toFixed(2)),
    hfaZ: a.hfaZ === null ? null : Number(a.hfaZ.toFixed(2)),
    bmiBand: a.bmiBand,
    hfaBand: a.hfaBand,
  }
}

/** One thing that happened on this workstation. */
export type RecordEventKind =
  | 'recorded'
  | 'absent'
  | 'slip-printed'
  | 'attended'
  | 'immunization'

export interface RecordEvent {
  kind: RecordEventKind
  learnerId: string
  /** ISO timestamp where one was written, otherwise the record's own date. */
  at: string
  by?: string
}

export interface RosterApi {
  learners: Learner[]
  ready: boolean
  savedCount: number
  absentIds: Set<string>
  /** What has been done on this laptop, newest first. */
  events: RecordEvent[]
  savedAt: string | null
  /** Why the last write did not land, or null.
   *
   * THIS USED TO HAVE NOWHERE TO GO. The server store already held a message
   * for every failed write and threw it as well, and every caller swallowed
   * the throw - so a measurement the server refused left the nurse looking at
   * a screen that had simply not changed. Between weighing rounds that is not
   * a rare case: the API declines a date outside the open round, correctly,
   * and the person typing had no way to learn that.
   *
   * Null on the offline build, which writes to a local file and cannot fail
   * this way. */
  error: string | null
  /** Dismiss the message above. */
  clearError: () => void
  /** Record a measurement and persist it. */
  /** `note` is the nurse's note on this weigh-in; the offline build does not keep it. */
  record: (learnerId: string, heightCm: number, weightKg: number, on: string, note?: string) => void
  /** Undo one recorded measurement, or an absence. */
  /** Remove a measurement: the one dated `on`, or the latest. */
  unrecord: (learnerId: string, on?: string) => void
  /** Mark a learner absent for this weigh-in. */
  skip: (learnerId: string, on: string) => void
  /** Record what the learner's immunization card showed. */
  setImmunization: (learnerId: string, status: ImmunizationStatus, on: string) => void
  setSlip: (
    learnerId: string,
    slip: SlipState,
    stamp: string | null,
    meeting?: Meeting | null,
  ) => void
  /** The meeting the next printed slips will invite parents to. */
  meeting: Meeting | null
  setMeeting: (meeting: Meeting | null) => void
  /** The follow-up weigh-in in progress, or null. */
  followUp: FollowUp | null
  /** Start a follow-up weigh-in; any one in progress is ended first. */
  startFollowUp: (f: { label: string; startedOn: string; learnerIds: string[] }) => void
  /** End the follow-up weigh-in. Measurements already saved are kept. */
  endFollowUp: () => void
  /** Whose laptop this is, or null while the install is unclaimed. */
  install: Install | null
  claim: (install: Install) => void
  /** Throw away everything typed on this workstation. */
  clearAll: () => void
}


/* One shared copy for the whole app. A context would be tidier, but this is a
   single-window desktop application and every screen wants the same list; a
   module-level store with subscribers keeps the screens free of providers. */
let state: RecordsFile = { ...EMPTY }
let loaded = false

/* Bumped on every write. The derived lists below used to be memoised on
   `state.savedAt` and the size of the measurements map, which meant a change
   that altered neither - printing a slip, scanning an arriving parent - left
   every screen holding the list it had computed before the write. The counts
   only caught up on a reload, and a second scan of the same stub read the
   pre-scan state and logged a second arrival instead of a duplicate.

   A revision counter is the honest dependency: one number that changes
   whenever anything in the file does, so no future field can be added and
   silently left out of the list of things worth recomputing for. */
let rev = 0
const listeners = new Set<() => void>()

function emit() {
  for (const fn of listeners) fn()
}

async function persist() {
  /* Stamped in memory as well as on disk. The footer reads savedAt off the
     in-memory copy, and only the stored copy was being given a time. */
  state = { ...state, savedAt: new Date().toISOString() }
  rev++
  await saveRecords(state)
  emit()
}

/* --- The derived lists, computed once per revision ------------------------

   These used to be three useMemo calls inside the hook, which meant they ran
   once per MOUNTED COMPONENT rather than once per change. The shell and the
   dashboard are both subscribers, so every write rebuilt the roster twice -
   and rebuilding the roster is not cheap: it re-runs the WHO assessment for
   every learner carrying a saved measurement, and on the school-wide install
   that is the whole school. The activity feed then sorted its own copy of the
   same events again, once per component.

   One cache, keyed on the revision counter, shared by every subscriber. It is
   also what makes useSyncExternalStore safe below: that hook requires a
   snapshot function returning an IDENTICAL object until something actually
   changes, and a fresh filter-and-map on every call would loop forever.
   `computedRev` starts at -1 so the first call always computes.
-------------------------------------------------------------------------- */

interface Derived {
  learners: Learner[]
  absentIds: Set<string>
  events: RecordEvent[]
}

let computedRev = -1
let derived: Derived = { learners: [], absentIds: new Set(), events: [] }

function compute(): Derived {
  /* The roster this install is allowed to see, and the only place that
     decision is made. Both roles - the head and the nurse - read the whole
     school. An unclaimed install sees nobody rather than everybody. */
  const base = state.install ? LEARNERS : []

  const learners = base.map((l) =>
    applyImmunization(applyRecord(withSlip(l, state), state.measurements[l.id]), state),
  )

  const absentIds = new Set(Object.keys(state.absences))

  /* What has happened on this laptop, newest first.

     Only things this install actually did: a measurement typed, a learner
     marked absent, an immunization card checked, a slip run off, a parent
     scanned in at the door. The sample roster contributes nothing here - it
     was never recorded on this machine, and a feed that opened with nine
     events nobody performed would be the one part of the screen that cannot
     be trusted.

     Events carry the timestamp they were written with where there is one,
     and fall back to the date the record belongs to for files saved before
     `at` existed. Ordering is by that string, which sorts correctly for both
     because ISO dates and ISO datetimes share a prefix. */
  const ids = new Set(learners.map((l) => l.id))
  const events: RecordEvent[] = []

  for (const [id, m] of Object.entries(state.measurements)) {
    if (!ids.has(id)) continue
    events.push({ kind: 'recorded', learnerId: id, at: m.at ?? m.measuredOn, by: m.by })
  }
  for (const [id, a] of Object.entries(state.absences)) {
    if (!ids.has(id)) continue
    events.push({ kind: 'absent', learnerId: id, at: a.at ?? a.measuredOn, by: a.by })
  }
  for (const [id, v] of Object.entries(state.immunizations)) {
    if (!ids.has(id)) continue
    events.push({ kind: 'immunization', learnerId: id, at: v.at ?? v.checkedOn, by: v.by })
  }
  for (const [id, sl] of Object.entries(state.slips)) {
    if (!ids.has(id)) continue
    if (sl.printedAt) events.push({ kind: 'slip-printed', learnerId: id, at: sl.printedAt })
    if (sl.attendedAt) events.push({ kind: 'attended', learnerId: id, at: sl.attendedAt })
  }
  events.sort((a, b) => b.at.localeCompare(a.at))

  return { learners, absentIds, events }
}

function snapshot(): Derived {
  if (computedRev !== rev) {
    derived = compute()
    computedRev = rev
  }
  return derived
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/* --- The mutators --------------------------------------------------------

   Module-level rather than useCallback'd inside the hook. They close over
   nothing but the module's own `state`, so there was never a reason for every
   mounted component to hold its own function identity for them - and a stable
   identity means a screen that hands `record` to a memoised child stops
   re-rendering that child whenever anything else on the screen changes.
-------------------------------------------------------------------------- */

/** Who is writing. One account per install for now, but the field exists so
    the audit trail has something real to say when accounts do. */
function actor(): string {
  return state.install?.adviser ?? 'm.ocampo'
}

function record(learnerId: string, heightCm: number, weightKg: number, on: string) {
  state = {
    ...state,
    measurements: {
      ...state.measurements,
      [learnerId]: {
        heightCm,
        weightKg,
        measuredOn: on,
        by: actor(),
        at: new Date().toISOString(),
      },
    },
  }
  void persist()
}

function unrecord(learnerId: string) {
  const m = { ...state.measurements }
  const a = { ...state.absences }
  delete m[learnerId]
  delete a[learnerId]
  state = { ...state, measurements: m, absences: a }
  void persist()
}

function skip(learnerId: string, on: string) {
  state = {
    ...state,
    absences: {
      ...state.absences,
      [learnerId]: { measuredOn: on, by: actor(), at: new Date().toISOString() },
    },
  }
  void persist()
}

function setImmunization(learnerId: string, status: ImmunizationStatus, on: string) {
  state = {
    ...state,
    immunizations: {
      ...state.immunizations,
      [learnerId]: { status, checkedOn: on, by: actor(), at: new Date().toISOString() },
    },
  }
  void persist()
}

function setSlip(
  learnerId: string,
  slip: SlipState,
  stamp: string | null,
  meeting?: Meeting | null,
) {
  const prev = state.slips[learnerId]
  state = {
    ...state,
    slips: {
      ...state.slips,
      [learnerId]: {
        slip,
        /* Only the print transition may write a print date. A scan at the
           meeting door knows a parent arrived; it does not know when the
           invitation was run off, and stamping today's date there would
           invent a fact - the same rule the PDF path follows when it refuses
           to stamp an unconfirmed paper print. */
        printedAt:
          slip === 'not-printed'
            ? null
            : (prev?.printedAt ?? (slip === 'printed' ? stamp : null)),
        attendedAt: slip === 'attended' ? stamp : (prev?.attendedAt ?? null),
        /* Frozen at print time. Re-printing a slip re-stamps it with the
           meeting now in force, which is correct - that is the paper the
           parent is holding. */
        meeting: slip === 'printed' ? (meeting ?? prev?.meeting ?? null) : (prev?.meeting ?? null),
      },
    },
  }
  void persist()
}

/* The meeting the next batch will name. Persisted so it is set once and every
   later print in the same round agrees with the first. */
function setMeeting(meeting: Meeting | null) {
  state = { ...state, meeting }
  void persist()
}

/* The follow-up weigh-in. Starting one replaces any in progress. */
function startFollowUp(f: { label: string; startedOn: string; learnerIds: string[] }) {
  state = { ...state, followUp: { id: `fu-${Date.now()}`, ...f } }
  void persist()
}

function endFollowUp() {
  state = { ...state, followUp: null }
  void persist()
}

/* Claiming the laptop. Done once, at first sign-in. */
function claim(install: Install) {
  state = { ...state, install }
  void persist()
}

function clearAll() {
  /* Whose laptop this is survives the reset. "Throw away everything typed"
     means the measurements and the slips, not the install's identity -
     clearing the sample data should not silently sign the adviser out and ask
     them who they are again. */
  state = { ...EMPTY, install: state.install }
  void persist()
}

/* --- The school-wide file: staff, notices, and the file itself -----------

   These sit beside the roster rather than inside RosterApi on purpose. Every
   one of them is a fact about the SCHOOL - who has an account, what the head
   has posted, what the record file as a whole contains - and RosterApi is the
   contract the server store also implements. Widening it would oblige
   lib/server-records.ts to grow five endpoints that do not exist yet, and a
   method that throws on one backend is not a shared interface.

   They are therefore local to this workstation in both builds, and the
   screens that use them say so.
-------------------------------------------------------------------------- */

function setStaff(id: string, patch: Partial<StaffRecord>) {
  const prev = state.staff[id]
  state = {
    ...state,
    staff: {
      ...state.staff,
      [id]: {
        name: prev?.name,
        role: prev?.role ?? 'nurse',
        active: prev?.active ?? true,
        ...patch,
        updatedAt: new Date().toISOString(),
        by: actor(),
      },
    },
  }
  void persist()
}

/** Undo every change made to one baseline account. An account created here
    has no baseline to fall back to, so this removes it outright. */
function resetStaff(id: string) {
  const next = { ...state.staff }
  delete next[id]
  state = { ...state, staff: next }
  void persist()
}

/** The whole record file, for a backup. A deep copy, because the caller is
    about to serialise it while the store carries on being written to. */
export function snapshotRecords(): RecordsFile {
  return JSON.parse(JSON.stringify(state)) as RecordsFile
}

/** Replace everything on this workstation with the contents of a backup.

    The install is NOT taken from the file. A backup restored onto a different
    laptop would otherwise silently sign that machine in as somebody else, and
    the person doing the restore is signed in on this one. */
export async function restoreRecords(raw: unknown): Promise<void> {
  const file = normalise(raw as Partial<RecordsFile>)
  state = { ...file, install: state.install }
  loaded = true
  rev++
  await persist()
}

/** What a backup file looks like from the outside, before it is trusted. */
export function describeBackup(raw: unknown): {
  ok: boolean
  reason?: string
  version?: number
  savedAt?: string | null
  measurements?: number
  slips?: number
} {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'That file is not JSON.' }
  const f = raw as Partial<RecordsFile>
  /* A CHAS backup always has a version and a measurements map, even when the
     map is empty. Anything else is some other JSON file, and restoring it
     would wipe the workstation with nothing to show for it. */
  if (typeof f.version !== 'number' || typeof f.measurements !== 'object') {
    return { ok: false, reason: 'That file is not a CHAS backup.' }
  }
  if (f.version > EMPTY.version) {
    return {
      ok: false,
      reason: `That backup was written by a newer version of CHAS (file ${f.version}, this build reads ${EMPTY.version}).`,
    }
  }
  return {
    ok: true,
    version: f.version,
    savedAt: f.savedAt ?? null,
    measurements: Object.keys(f.measurements ?? {}).length,
    slips: Object.keys(f.slips ?? {}).length,
  }
}

/** The load that both hooks depend on, written once.

    It used to live inside useLocalRoster, which was fine while that was the
    only reader of the file. The Roles screen reads the same
    file without wanting a roster, and a screen that opened before the roster
    hook had mounted anywhere would have rendered an empty staff list. */
function useRecordsFile(): void {
  useEffect(() => {
    if (loaded) return
    let cancelled = false
    void loadRecords().then((d) => {
      if (cancelled) return
      state = d
      loaded = true
      /* The revision has to move, or the snapshot cache hands every
         subscriber the empty roster it computed before the file landed. */
      rev++
      emit()
    })
    return () => {
      cancelled = true
    }
  }, [])
}

/* `state` is replaced wholesale on every write, so its identity is already
   the change signal useSyncExternalStore wants. */
const fileSnapshot = () => state

export interface SchoolApi {
  ready: boolean
  staff: Record<string, StaffRecord>
  setStaff: (id: string, patch: Partial<StaffRecord>) => void
  resetStaff: (id: string) => void
  savedAt: string | null
}

/** Staff accounts, as kept on this workstation. */
export function useSchool(): SchoolApi {
  const s = useSyncExternalStore(subscribe, fileSnapshot, fileSnapshot)
  useRecordsFile()
  return {
    ready: loaded,
    staff: s.staff,
    setStaff,
    resetStaff,
    savedAt: s.savedAt,
  }
}

/* The backend flag lives in ./backend so both stores can read it without
   an import cycle. Re-exported here because every screen already imports it
   from records. */
export { SERVER_BACKED } from './backend'

export function useLocalRoster(): RosterApi {
  /* useSyncExternalStore rather than a useState counter and a hand-rolled
     subscribe/emit. It is the hook React provides for exactly this store, and
     it gets two things the hand-rolled version did not: the subscription is
     established before the first paint rather than in an effect after it, so
     a write landing in that gap is not missed; and concurrent renders are
     handed a consistent snapshot instead of tearing between two components
     that read the module at different moments. */
  const { learners, absentIds, events } = useSyncExternalStore(subscribe, snapshot, snapshot)

  useRecordsFile()

  return {
    learners,
    ready: loaded,
    savedCount: Object.keys(state.measurements).length,
    absentIds,
    events,
    savedAt: state.savedAt,
    /* See the note on the other local return: a file write on this machine is
       not something the app is refused. */
    error: null,
    clearError: () => {},
    record,
    unrecord,
    skip,
    setImmunization,
    setSlip,
    meeting: state.meeting,
    setMeeting,
    followUp: state.followUp,
    startFollowUp,
    endFollowUp,
    install: state.install,
    claim,
    clearAll,
  }
}

function withSlip(l: Learner, s: RecordsFile): Learner {
  const rec = s.slips[l.id]
  return rec
    ? { ...l, slip: rec.slip, printedAt: rec.printedAt, attendedAt: rec.attendedAt, slipMeeting: rec.meeting }
    : l
}

/** Merge a recorded immunization check over the roster's generated baseline,
    the same way a saved measurement is merged over it. */
function applyImmunization(l: Learner, s: RecordsFile): Learner {
  const rec = s.immunizations[l.id]
  return rec ? { ...l, immunization: rec.status } : l
}

/* The hook every screen actually calls.

   Both stores expose the identical `RosterApi`, so this is a straight
   dispatch and no screen has to know which one it got. Calling both
   unconditionally is what keeps the Rules of Hooks satisfied - a conditional
   `if (SERVER_BACKED) return useServerRoster()` would change the hook order
   between renders the moment the flag were ever anything but a constant, and
   `import.meta.env` is exactly the kind of thing that stops being constant
   when somebody adds a runtime override.

   The cost is that the unused store subscribes and sits idle. It does no
   fetching and holds one empty object; that is a great deal cheaper than the
   class of bug the conditional invites. */
export function useRoster(): RosterApi {
  const local = useLocalRoster()
  const server = useServerRoster()
  return SERVER_BACKED ? server : local
}
