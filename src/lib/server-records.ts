/* The roster, backed by the API instead of a file on disk.

   THE CONTRACT. This exports `useServerRoster()`, which returns the same
   `RosterApi` shape `records.ts` does. That is the whole design: nine screens
   read their data through one hook, so moving the source of truth from a JSON
   file to PostgreSQL is a change to this file and to the two lines in
   `records.ts` that choose between them - not a change to Dashboard,
   Learners, WeighIn, Slips, Attendance or Admin, none of which know a server
   exists.

   WHAT CHANGES ANYWAY, honestly:

     - `claim()` is gone in spirit. Identity used to be a thing the laptop
       decided about itself and wrote into its own records file; it is now
       whatever the server says the session is. A laptop can no longer declare
       itself to be Grade 4. It throws rather than silently doing nothing,
       because a caller that still expects the old behaviour is a bug worth
       seeing.

     - `clearAll()` likewise. On a local file it meant "throw away what I
       typed on this machine". Against a shared database it would mean "delete
       the school's records", which is not a button, and certainly not one
       reachable without a confirmation the API does not implement.

     - `savedAt` is the time of the last successful WRITE, not of a file
       flush. There is no file.

   READ-THROUGH, NOT OPTIMISTIC. A write POSTs and then refetches the roster
   before the screens see anything change. That is slower than patching local
   state and rolling back on failure, and it is the right trade here: the
   server recomputes nothing but it does enforce (a measurement clears an
   absence, a slip needs a meeting), and a UI that guessed at those rules
   would drift from them. A nurse typing a weigh-in on a school connection
   would rather wait 80ms than see a number that turns out not to have
   saved. */

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { Learner, SlipState, ImmunizationStatus } from '../data/mock'
import { assess } from './nutrition'
import {
  ApiError,
  endpoints,
  type ApiActivity,
  type ApiFollowUp,
  type ApiLearner,
  type ApiMeeting,
} from './api'
import { roleFromServer } from './records'
import type { FollowUp, Install, Meeting, RecordEvent, RecordEventKind, RosterApi } from './records'
import { SERVER_BACKED } from './backend'
import { invalidate } from './query'
import { toast } from '../components/toast'
import { schoolYearStart, setSchoolInfo } from './school-year'
import { slipTextOf } from './slip-text'

/* --- The module store, same pattern as records.ts ------------------------ */

interface ServerState {
  learners: Learner[]
  absentIds: Set<string>
  events: RecordEvent[]
  meeting: Meeting | null
  followUp: FollowUp | null
  install: Install | null
  ready: boolean
  savedAt: string | null
  /** The last error a write produced, for a screen that wants to say so. */
  error: string | null
}

const EMPTY: ServerState = {
  learners: [],
  absentIds: new Set(),
  events: [],
  meeting: null,
  followUp: null,
  install: null,
  ready: false,
  savedAt: null,
  error: null,
}

let state: ServerState = EMPTY
const listeners = new Set<() => void>()

function emit() {
  for (const fn of listeners) fn()
}

function set(patch: Partial<ServerState>) {
  state = { ...state, ...patch }
  emit()
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/* useSyncExternalStore needs a snapshot that is reference-stable until
   something actually changes. `state` is replaced wholesale by `set`, so
   returning it directly satisfies that. */
function snapshot(): ServerState {
  return state
}

/* --- Turning API rows into the Learner the screens already know ---------- */

/* The bands are computed HERE, from height, weight, birth date and sex - the
   server sends none of them. One implementation of the WHO classification,
   the one that has been checked against the published tables to 0.0005, and
   no second copy in SQL to drift from it. */
function toLearner(a: ApiLearner, syStart: string): Learner {
  /* A measurement from before this school year is not this year's status.
     After the head starts a new year, a promoted learner reads as not yet
     measured until the baseline weigh-in, rather than carrying last year's
     endline into the new grade, the slips and the SF8. */
  const current = Boolean(a.measuredOn && a.measuredOn >= syStart)
  const base: Learner = {
    id: a.id,
    lrn: a.lrn,
    lastName: a.lastName,
    firstName: a.firstName,
    middleName: a.middleName,
    sex: a.sex,
    birthDate: a.birthDate ?? '',
    section: a.section,
    gradeLevel: a.gradeLevel,
    gradeName: a.gradeName,
    heightCm: current ? a.heightCm : null,
    weightKg: current ? a.weightKg : null,
    measuredOn: current ? a.measuredOn : null,
    measurementNote: current ? (a.measurementNote ?? '') : '',
    previous:
      !current && a.measuredOn && a.heightCm != null && a.weightKg != null
        ? { heightCm: a.heightCm, weightKg: a.weightKg, measuredOn: a.measuredOn }
        : null,
    bmiZ: null,
    hfaZ: null,
    bmiBand: null,
    hfaBand: null,
    slip: a.slip as SlipState,
    printedAt: a.printedAt,
    attendedAt: a.attendedAt,
    slipMeeting: a.slipMeeting?.date
      ? { date: a.slipMeeting.date, time: a.slipMeeting.time, venue: a.slipMeeting.venue }
      : null,
    stubId: a.stubId,
    immunization: a.immunization as ImmunizationStatus,
  }

  if (!current || a.heightCm == null || a.weightKg == null || !a.measuredOn || !a.birthDate) return base

  const r = assess(a.weightKg, a.heightCm, a.birthDate, a.measuredOn, a.sex)
  return {
    ...base,
    bmiZ: r.bmiZ === null ? null : Number(r.bmiZ.toFixed(2)),
    hfaZ: r.hfaZ === null ? null : Number(r.hfaZ.toFixed(2)),
    bmiBand: r.bmiBand,
    hfaBand: r.hfaBand,
  }
}

/* The audit actions the activity feed knows how to draw. Anything else the
   server logs - a sign-in, a passphrase change - is real history but is not a
   thing that happened to a learner, so it does not belong on this panel. */
const EVENT_KIND: Record<string, RecordEventKind> = {
  MEASUREMENT_RECORDED: 'recorded',
  LEARNER_MARKED_ABSENT: 'absent',
  IMMUNIZATION_RECORDED: 'immunization',
  SLIP_PRINTED: 'slip-printed',
  MEETING_ATTENDANCE_RECORDED: 'attended',
}

function toEvents(rows: ApiActivity[]): RecordEvent[] {
  const out: RecordEvent[] = []
  for (const r of rows) {
    const kind = EVENT_KIND[r.action]
    if (!kind || !r.learnerId) continue
    out.push({ kind, learnerId: r.learnerId, at: r.at, by: r.by ?? undefined })
  }
  return out
}

function toMeeting(m: ApiMeeting | null): Meeting | null {
  return m ? { date: m.date, time: m.time, venue: m.venue } : null
}

/* --- Loading ------------------------------------------------------------- */

let inFlight: Promise<void> | null = null

/* Boot happens once for the whole app, not once per component.

   It was a useState inside the hook, which meant every component calling
   useRoster() - the shell AND whichever screen is mounted - ran its own
   `/api/auth/me` and its own roster fetch. Two identical round trips on
   every navigation, and the network tab showed it. A module-level flag is the
   correct scope, because the thing being guarded is module-level state. */
let booted = false

/**
 * Pull the roster, the activity feed and the meeting.
 *
 * Three requests in parallel rather than in sequence: they do not depend on
 * each other, and on a school connection three round trips one after another
 * is most of a second of the nurse looking at an empty screen.
 *
 * Concurrent calls share one promise. Without that, five writes in quick
 * succession - which is exactly what a weigh-in queue produces - would each
 * start their own refetch and the last response to land would win, which is
 * not necessarily the newest.
 */
export function refresh(): Promise<void> {
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      const [roster, activity, meeting, followUp] = await Promise.all([
        endpoints.learners(),
        endpoints.activity(20),
        endpoints.meeting(),
        /* A server from before the follow-up weigh-in answers 404 here;
           that reads as "none in progress" rather than as a failed load. */
        endpoints.followUp().catch(() => ({ followUp: null as ApiFollowUp | null })),
      ])

      setSchoolInfo({
        schoolYear: roster.schoolYear,
        advisers: roster.advisers,
        ...(roster.classes ? { classes: roster.classes } : {}),
        /* An older server sends no school; the details on hand stay. */
        ...(roster.school ? { school: roster.school } : {}),
        slipText: slipTextOf(roster.slipText),
      })
      /* 1 June of the school year's first calendar year, as the rounds use. */
      const syStart = `${schoolYearStart(roster.schoolYear)}-06-01`
      set({
        learners: roster.learners.map((l) => toLearner(l, syStart)),
        /* Absent this school year and not measured since. */
        absentIds: new Set(
          roster.learners
            .filter(
              (l) =>
                l.absentOn &&
                l.absentOn >= syStart &&
                (!l.measuredOn || l.measuredOn < syStart || l.absentOn > l.measuredOn),
            )
            .map((l) => l.id),
        ),
        events: toEvents(activity.events),
        meeting: toMeeting(meeting.meeting),
        followUp: followUp.followUp
          ? {
              id: followUp.followUp.id,
              label: followUp.followUp.label,
              startedOn: followUp.followUp.startedOn,
              learnerIds: followUp.followUp.learnerIds,
            }
          : null,
        ready: true,
        error: null,
      })
    } catch (err) {
      /* A 401 means the session went away - expired, or revoked from another
         machine. The install is cleared, which is what sends the shell back
         to sign-in; it is not an error to show, it is a state to be in. */
      if (err instanceof ApiError && (err.status === 401 || err.code === 'PASSWORD_CHANGE_REQUIRED')) {
        set({ ...EMPTY, ready: true })
        return
      }
      set({ ready: true, error: err instanceof Error ? err.message : 'Could not load the learner list.' })
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}

/** Called by the sign-in screen once the server has said who this is. */
export function setInstall(install: Install | null) {
  set({ install })
}

/** Wipe everything in memory. Used on sign-out, so the next account does not
    see the previous one's roster for the frame before its own arrives. */
export function resetStore() {
  invalidate()
  state = { ...EMPTY, ready: true }
  emit()
}

/* --- Writes -------------------------------------------------------------- */

/* The screens stamp a slip with a day ("2026-10-12"); the API wants an
   instant, and refused a bare date with "Check the slip" - which is how every
   print and every scan on this build ended in a red toast after the green
   one. Today becomes now, so a scan at the door keeps its arrival time; any
   other day becomes that day's local noon, which no time zone moves onto
   the day before or after. */
function slipInstant(stamp: string | null): string | undefined {
  if (!stamp) return undefined
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stamp)) return new Date(stamp).toISOString()
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return stamp === today ? now.toISOString() : new Date(`${stamp}T12:00:00`).toISOString()
}

/* Each one POSTs, then refetches. `savedAt` is stamped only on success, so a
   footer reading "saved at 09:14" is never showing the time of a write that
   failed. */
async function write(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
    await refresh()
    set({ savedAt: new Date().toISOString(), error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The change could not be saved. Try again.'
    set({ error: message })
    toast.error(`Not saved. ${message}`)
    /* Rethrown as well as stored. A screen that wants to keep the nurse's
       typing on screen after a failure needs to know it failed, and a screen
       that does not care can ignore it - but the failure must not be
       swallowed here, silently, into a UI that looks like it worked. */
    throw err
  }
}

/* --- The hook ------------------------------------------------------------ */

export function useServerRoster(): RosterApi {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot)

  useEffect(() => {
    /* The local build calls this hook too - useRoster() calls both stores
       unconditionally so the hook order can never change - and it must not
       touch the network when it does. Without this guard the offline desktop
       build fires /api/auth/me at a server that is not there, once per
       mounted component, and logs a connection error for each. */
    if (!SERVER_BACKED) return
    if (booted) return
    booted = true
    /* Ask the server who we are before asking for a roster. A cold browser
       may be holding a valid cookie from a previous session, and this is what
       turns that cookie back into a signed-in app without a second sign-in. */
    void endpoints
      .me()
      .then(({ user }) => {
        const role = roleFromServer(user.role)
        /* A session still waiting on a new password is ended: the sign-in
           screen asks for the password again and then for the new one. */
        if (user.mustChangePassword) {
          void endpoints.signOut().catch(() => {})
          set({ ...EMPTY, ready: true })
          return
        }
        /* A role this client does not know is treated as signed out. */
        if (!role) {
          set({ ...EMPTY, ready: true })
          return
        }
        set({ install: { adviser: user.fullName, section: '', role } })
        return refresh()
      })
      .catch(() => {
        /* No session. Not an error - it is the signed-out state, and the
           shell's own redirect handles it from here. */
        set({ ...EMPTY, ready: true })
      })
  }, [booted])

  const record = useCallback(
    (learnerId: string, heightCm: number, weightKg: number, on: string, note?: string) => {
      void write(() => endpoints.recordMeasurement(learnerId, heightCm, weightKg, on, note)).catch(
        () => {},
      )
    },
    [],
  )

  const unrecord = useCallback(
    (learnerId: string, date?: string) => {
      /* The API deletes by (learner, session date), because a learner may
         have several measurements now - which the file store could never
         represent. Without a date, "Undo" means the one currently on screen. */
      const l = state.learners.find((x) => x.id === learnerId)
      const on = date ?? l?.measuredOn
      if (!on) return
      void write(() => endpoints.withdrawMeasurement(learnerId, on)).catch(() => {})
    },
    [],
  )

  const skip = useCallback((learnerId: string, on: string) => {
    void write(() => endpoints.markAbsent(learnerId, on)).catch(() => {})
  }, [])

  const setImmunization = useCallback(
    (learnerId: string, status: ImmunizationStatus, on: string) => {
      void write(() => endpoints.setImmunization(learnerId, status, on)).catch(() => {})
    },
    [],
  )

  const setSlip = useCallback(
    (learnerId: string, slip: SlipState, stamp: string | null) => {
      void write(() => endpoints.setSlip(learnerId, slip, slipInstant(stamp))).catch(() => {})
    },
    [],
  )

  const setMeeting = useCallback((meeting: Meeting | null) => {
    /* There is no "unset the meeting" endpoint, and there should not be: a
       meeting that has had slips printed against it is on paper in parents'
       hands. Clearing it locally would make the app disagree with the
       invitations. */
    if (!meeting) return
    void write(() => endpoints.setMeeting(meeting.date, meeting.time, meeting.venue)).catch(
      () => {},
    )
  }, [])

  const startFollowUp = useCallback((f: { label: string; startedOn: string; learnerIds: string[] }) => {
    void write(() => endpoints.startFollowUp(f.label, f.startedOn, f.learnerIds)).catch(() => {})
  }, [])

  const endFollowUp = useCallback(() => {
    void write(() => endpoints.endFollowUp()).catch(() => {})
  }, [])

  const claim = useCallback(() => {
    throw new Error(
      'This build gets its identity from the server. Sign in instead of claiming the install.',
    )
  }, [])

  const clearAll = useCallback(() => {
    throw new Error('This action is not available.')
  }, [])

  const savedCount = useMemo(() => s.learners.filter((l) => l.measuredOn).length, [s.learners])

  return {
    learners: s.learners,
    ready: s.ready,
    savedCount,
    absentIds: s.absentIds,
    events: s.events,
    savedAt: s.savedAt,
    error: s.error,
    clearError: () => set({ error: null }),
    record,
    unrecord,
    skip,
    setImmunization,
    setSlip,
    meeting: s.meeting,
    setMeeting,
    followUp: s.followUp,
    startFollowUp,
    endFollowUp,
    install: s.install,
    claim,
    clearAll,
  }
}

/** The last write error, for screens that want to surface it. */
export function useRosterError(): string | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot).error
}
