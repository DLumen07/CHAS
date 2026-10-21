/* The HTTP client, and the one place the front-end knows a server exists.

   WHY IT IS ONE FILE. Every screen in this app reads its data through
   `useRoster()`, and that hook used to talk to a file on disk. Putting the
   fetches behind this module means the swap from "a JSON file" to "a
   PostgreSQL server" changes two files rather than nine screens - and it
   means the retry, the error shape and the credentials rule are decided once
   instead of being reinvented per call site.

   CREDENTIALS. Every request sends `credentials: 'include'`, because the
   session lives in an httpOnly cookie rather than a token in localStorage.
   That is the deliberate choice: a token in localStorage is readable by any
   script on the page, so a single XSS in a React tree that renders learner
   names is enough to walk away with a live session. An httpOnly cookie cannot
   be read by script at all. The cost is that CORS must name an exact origin
   and the server must set SameSite - both handled in server/src/index.ts. */

import { invalidate } from './query'
import type { SchoolIdentity } from './school-year'
import type { SlipText } from './slip-text'

/* Where the API lives.

   In development Vite proxies /api to :4000 (see vite.config.ts), so the
   default is a same-origin relative path and no CORS is involved at all. A
   deployed browser build sets VITE_API_URL at build time; the Electron build
   must set it, because a page loaded over file:// has no origin to be
   relative to. */
const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The server's stable machine code - BAD_CREDENTIALS, NO_MEETING,
        OUT_OF_SCOPE. Branch on this, never on the sentence: the sentence is
        written for a person and may be reworded. */
    readonly code: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** Thrown when the browser could not reach the server at all. */
export class OfflineError extends Error {
  constructor() {
    /* Worth its own type. "The network is down" and "the server said no" look
       identical at a call site that only checks for a thrown value, and they
       need opposite responses: one is retried, the other is shown to the
       nurse. This app runs in schools with unreliable connections, so the
       distinction is not academic. */
    super('CHAS is not responding. Close it and open it again; if that does not help, restart the computer.')
    this.name = 'OfflineError'
  }
}

interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Sent as it is, with its own type, instead of as JSON: the school logo. */
  blob?: Blob
  signal?: AbortSignal
}

/** The school's logo as the server serves it. `version` is the school's
    logoVersion, so a new logo is a new URL and never a cached old one. */
export function schoolLogoUrl(version: string): string {
  return `${BASE}/api/school/logo?v=${encodeURIComponent(version)}`
}

async function request<T>(path: string, opts: Options = {}): Promise<T> {
  const { method = 'GET', body, blob, signal } = opts

  let res: Response
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      credentials: 'include',
      headers: blob ? { 'Content-Type': blob.type } : body ? { 'Content-Type': 'application/json' } : undefined,
      body: blob ?? (body === undefined ? undefined : JSON.stringify(body)),
      signal,
    })
  } catch (err) {
    /* An aborted request is not a failure - it is a component unmounting or a
       newer request superseding this one - so it is rethrown untouched rather
       than reported to the user as an outage. */
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new OfflineError()
  }

  /* Any successful write can change what a cached read would return. */
  if (method !== 'GET' && res.ok) invalidate()

  if (res.status === 204) return undefined as T

  /* Parsed defensively. A 502 from a proxy in front of the API returns HTML,
     and `res.json()` on that throws a SyntaxError that would surface to the
     nurse as "Unexpected token <" - which tells her nothing and tells us
     nothing either. */
  let payload: unknown = null
  const text = await res.text()
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }

  if (!res.ok) {
    const p = payload as { error?: string; code?: string } | null
    throw new ApiError(
      res.status,
      p?.error ?? 'Something went wrong. Try again.',
      p?.code ?? 'UNKNOWN',
    )
  }

  return payload as T
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  /* PATCH rather than PUT for a partial edit. The staff routes take a few
     named fields and leave the rest alone, and a PUT that behaved that way
     would be lying about replacing the resource. */
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

/* --- What the endpoints return ------------------------------------------

   Hand-written rather than generated from Prisma. The server deliberately
   does not ship its band classification (see server/src/routes/learners.ts),
   so these are the raw facts and `nutrition.ts` turns them into bands on this
   side - which means the client's type is genuinely a different shape from
   the database row, not a copy of it.
------------------------------------------------------------------------- */

export interface ApiLearner {
  id: string
  lrn: string
  lastName: string
  firstName: string
  middleName: string
  sex: 'M' | 'F'
  birthDate: string | null
  section: string
  gradeLevel: number
  /** The year level as the school names it. */
  gradeName: string
  stubId: string
  heightCm: number | null
  weightKg: number | null
  measuredOn: string | null
  /** The nurse's note on the newest weigh-in; '' when none. Absent from older servers. */
  measurementNote?: string
  recordedAt: string | null
  immunization: 'complete' | 'incomplete' | 'none'
  immunizationCheckedOn: string | null
  slip: 'not-printed' | 'printed' | 'attended'
  printedAt: string | null
  attendedAt: string | null
  /** The meeting the slip was printed for. Absent from older servers. */
  slipMeeting?: { date: string | null; time: string; venue: string } | null
  absentOn: string | null
}

/** The two posts CHAS knows about. Both read the whole school - see the Role
    enum in server/prisma/schema.prisma. */
export type ApiRole = 'ADMIN' | 'NURSE'

export interface ApiUser {
  id: string
  username: string
  fullName: string
  role: ApiRole
  schoolId: string
  lastLoginAt: string | null
  sessionTtlHours: number
  /** The password was set by somebody else (a default, or the head). The
      server answers nothing else until it is changed. */
  mustChangePassword: boolean
}

/** A staff account, as the school head's Roles screen sees it. Never a hash
    and never a passphrase: the plaintext exists only in the response to the
    request that set it, and is not stored anywhere on this side either. */
export interface ApiStaff {
  id: string
  username: string
  fullName: string
  role: ApiRole
  lastLoginAt: string | null
  /** Non-null means the account is switched off. Accounts are never deleted:
      every measurement carries the id of whoever recorded it. */
  disabledAt: string | null
  createdAt: string
}


export interface ApiActivity {
  action: string
  at: string
  learnerId: string | null
  learner: { id: string; lastName: string; firstName: string } | null
  by: string | null
}

/* --- Registering a learner ------------------------------------------------

   The shapes below are the Add Learner dialog's contract. The health history
   is optional, and that is the design: a child can be registered on what the
   office has today, and the history is filled in when somebody actually
   knows it. Family contact details are not collected (removed 2026-10-15).
-------------------------------------------------------------------------- */

export type ConditionStatus = 'ACTIVE' | 'RESOLVED' | 'RECURRING' | 'UNKNOWN'
export type DoseStatus = 'GIVEN' | 'SCHEDULED' | 'MISSED' | 'UNKNOWN'
export type EnrolmentStatus =
  | 'ENROLLED'
  | 'TRANSFERRED_IN'
  | 'RETURNING'
  | 'TRANSFERRED_OUT'
  | 'DROPPED'

export interface ApiVaccineDose {
  vaccine: string
  dose: string
  givenOn?: string
  status: DoseStatus
  remarks?: string
}

export interface NewLearnerBody {
  lrn: string
  lastName: string
  firstName: string
  middleName?: string
  nameExt?: string
  sex: 'M' | 'F'
  birthDate: string
  sectionId: string
  enrolmentStatus?: EnrolmentStatus
  healthNotes?: string
  condition?: {
    condition: string
    status: ConditionStatus
    treatment?: string
    notes?: string
  }
  doses?: ApiVaccineDose[]
}

/** One row of an imported class list: what an SF1 carries, nothing more. */
export type ImportLearnerRow = Pick<
  NewLearnerBody,
  'lrn' | 'lastName' | 'firstName' | 'middleName' | 'nameExt' | 'sex' | 'birthDate'
>

export interface ImportLearnersBody {
  sectionId: string
  learners: ImportLearnerRow[]
}

/** One learner's full record, as `GET /learners/:id` returns it.

    Everything the registration dialog collects comes back here and nowhere
    else. It is deliberately not part of `ApiLearner`: that shape is sent for
    all 182 children on every page load, and four more joins per child so one
    dialog can show them one at a time is a bad trade. */
export interface ApiLearnerRecord {
  id: string
  lrn: string
  lastName: string
  firstName: string
  middleName: string
  nameExt: string
  sex: 'M' | 'F'
  birthDate: string | null
  section: string
  /** The id behind that name. The edit form's class picker needs something to
      be set to, and every other screen only ever displays the name. */
  sectionId: string
  gradeLevel: number
  stubId: string
  healthNotes: string
  /** Set once the learner has left the roster (graduated, transferred out,
      dropped). The record is kept whole. */
  archivedAt: string | null

  conditions: ApiCondition[]
  vaccineDoses: ApiDose[]
  enrolments: {
    schoolYear: string
    sectionId: string
    section: string
    gradeLevel: number
    /** The year level as the school names it: "Grade 6". */
    gradeName: string
    status: EnrolmentStatus
    /** How the year ended, once the head has closed it. */
    outcome: EnrolmentOutcome | null
  }[]
  /** Every year's invitation slip, newest first. */
  slips: {
    schoolYear: string
    state: 'not-printed' | 'printed' | 'attended'
    printedAt: string | null
    attendedAt: string | null
  }[]
  /** Every immunization card check, newest first. */
  immunizations: { status: 'complete' | 'incomplete' | 'none'; checkedOn: string | null; by: string }[]
  /** Weigh-in dates the learner was marked absent, newest first. */
  absences: { measuredOn: string | null }[]

  history: {
    heightCm: number | null
    weightKg: number | null
    measuredOn: string | null
    /** The nurse's note on this weigh-in; '' when none. Absent from older servers. */
    note?: string
    recordedAt: string
    by: string
  }[]

  /** Every save ever made against this learner, newest first.
   *
   * NOT THE SAME LIST AS `history`. That is the current measurements, one
   * per session, which is what the charts and the SF8 read. This is the
   * account of how they got there: a height typed twice on one morning is one
   * entry in `history` and two here, and a withdrawn one is absent from
   * `history` and still present here. */
  recordings: {
    id: string
    measuredOn: string | null
    /** Null on a withdrawal, which has no figure by definition. */
    heightCm: number | null
    weightKg: number | null
    kind: 'RECORDED' | 'CORRECTED' | 'WITHDRAWN'
    /** When somebody pressed save, which is not the session date. */
    at: string
    by: string
  }[]
}

/* The child rows carry their ids so an edit can UPDATE them rather than
   delete and recreate. Replacing every row on every save would rewrite
   `recordedById` and `createdAt` each time, so a condition first reported in
   June by the nurse would read as reported today by whoever fixed a typo in
   it. Provenance is the point of those columns. */

export interface ApiCondition {
  id: string
  condition: string
  status: ConditionStatus
  treatment: string
  notes: string
  recordedOn: string | null
  by: string
}

export interface ApiDose {
  id: string
  vaccine: string
  dose: string
  givenOn: string | null
  status: DoseStatus
  remarks: string
  by: string
}

/** The whole editable record, as one PUT.

    One body and one transaction, not nine endpoints: a Save that fired nine
    requests would leave a half-corrected child behind whichever one failed.
    Rows carrying an `id` are updated, rows without are created, and rows the
    payload no longer mentions are deleted. */
export interface EditLearnerBody {
  lrn: string
  lastName: string
  firstName: string
  middleName?: string
  nameExt?: string
  sex: 'M' | 'F'
  birthDate: string
  healthNotes?: string
  sectionId?: string
  enrolmentStatus?: EnrolmentStatus
  conditions: (Omit<ApiCondition, 'id' | 'recordedOn' | 'by'> & { id?: string })[]
  doses: (Omit<ApiDose, 'id' | 'by' | 'givenOn'> & { id?: string; givenOn?: string })[]
}

/** What the dialog may offer: the school year and the classes of the
    account's school. */
export interface ApiEnrolmentOptions {
  schoolYear: string
  schoolName: string
  sections: {
    id: string
    name: string
    gradeLevel: number
    /** The year's name, for screens that print it rather than count it. */
    gradeName: string
    gradeLevelId: string
  }[]
}

/** A class as the filters list it: the section and the year level it is in. */
export interface SchoolClass {
  name: string
  gradeLevel: number
  gradeName: string
}

/** The school's year levels in order, each with its sections, as the head
    edits them in School settings. */
export interface ApiGradeLevel {
  id: string
  name: string
  /** The position in the list, 1 to n. */
  level: number
  sections: {
    id: string
    name: string
    adviser: string
    /** Learners on the roster now. */
    learners: number
    /** False once any learner record points at the section. */
    removable: boolean
  }[]
}

export interface SectionBody {
  name: string
  gradeLevelId: string
  adviser: string
}

/** A learner who has left the roster, as the former-learners list shows them. */
export interface ApiFormerLearner {
  id: string
  lrn: string
  lastName: string
  firstName: string
  middleName: string
  nameExt: string
  sex: 'M' | 'F'
  birthDate: string | null
  archivedAt: string
  /** The class and year they were last enrolled in. */
  section: string
  gradeName: string
  schoolYear: string | null
  outcome: EnrolmentOutcome | null
  status: EnrolmentStatus | null
}

export type EnrolmentOutcome = 'PROMOTED' | 'RETAINED' | 'COMPLETED' | 'TRANSFERRED_OUT' | 'DROPPED'

/** The school year as the head's rollover screen reads it. */
export interface ApiSchoolYear {
  schoolYear: string
  /** The year after, worked out from the label; null if it is not "YYYY-YYYY". */
  nextYear: string | null
  grades: {
    level: number
    name: string
    sections: { id: string; name: string; adviser: string }[]
  }[]
  /** Learners already marked as transferred out or dropped this year. */
  defaults: Record<string, 'TRANSFERRED_OUT' | 'DROPPED'>
  /** The newest rollover, while the school is still in the year it opened. */
  lastRollover: {
    id: string
    fromYear: string
    toYear: string
    rolledAt: string
    by: string
    /** Why it can no longer be undone. Empty while it can. */
    blockers: string[]
  } | null
}

export interface RolloverBody {
  fromYear: string
  toYear: string
  /** The exceptions only. Everyone else is promoted, or completes the last grade. */
  outcomes: Record<string, EnrolmentOutcome>
  sectionMap: Record<string, string>
  advisers: Record<string, string>
}

/** An extra weigh-in for a chosen set of learners (2026-10-11). */
export interface ApiFollowUp {
  id: string
  label: string
  startedOn: string
  learnerIds: string[]
  closedAt: string | null
}

export interface ApiMeeting {
  id: string
  date: string
  time: string
  venue: string
}

/** A meeting in the history list, with its invitation and attendance counts. */
export interface ApiMeetingSummary {
  id: string
  date: string
  time: string
  venue: string
  isCurrent: boolean
  invited: number
  attended: number
}

/** One meeting and the parents recorded as attended, newest first. */
export interface ApiMeetingDetail {
  meeting: Omit<ApiMeetingSummary, 'invited' | 'attended'>
  invited: number
  attendees: { learnerId: string; name: string; section: string; stubId: string; attendedAt: string | null }[]
}

export const endpoints = {
  meetings: () => api.get<{ meetings: ApiMeetingSummary[] }>('/meetings'),
  meetingDetail: (id: string) => api.get<ApiMeetingDetail>(`/meetings/${id}`),
  me: () => api.get<{ user: ApiUser }>('/auth/me'),
  signIn: (username: string, password: string) =>
    api.post<{ user: ApiUser; expiresAt: string }>('/auth/sign-in', { username, password }),
  signOut: () => api.post<void>('/auth/sign-out'),
  /** Asks for the signed-in person's password again before a backup or a restore. */
  confirmPassword: (password: string, purpose: 'backup' | 'restore') =>
    api.post<{ ok: true }>('/auth/confirm-password', { password, purpose }),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ ok: true }>('/auth/change-password', { currentPassword, newPassword }),

  /* Forgotten password, before sign-in: one of the account's own printed
     recovery codes and a new password. */
  resetWithRecoveryCode: (username: string, code: string, password: string) =>
    api.post<{ ok: true; remaining: number }>('/auth/recover', { username, code, password }),

  learners: (signal?: AbortSignal) =>
    api.get<{
      schoolYear: string
      school: SchoolIdentity
      /** Null: the wording shipped with the app. Absent from an older server. */
      slipText?: Partial<SlipText> | null
      advisers: Record<string, string>
      /** Every class in order. Absent from an older server. */
      classes?: SchoolClass[]
      learners: ApiLearner[]
    }>(
      '/learners',
      signal,
    ),
  /* Before sign-in: the year the sign-in screen prints. */
  school: () => api.get<{ schoolYear: string | null; school: SchoolIdentity | null }>('/auth/school'),

  /* --- School settings, school head only -------------------------------- */
  updateSchool: (body: Omit<SchoolIdentity, 'logoVersion'>) =>
    api.put<{ school: SchoolIdentity }>('/school', body),
  /** A PNG the browser has already scaled down. */
  uploadSchoolLogo: (png: Blob) =>
    request<{ school: SchoolIdentity }>('/school/logo', { method: 'PUT', blob: png }),
  removeSchoolLogo: () => api.del<{ school: SchoolIdentity }>('/school/logo'),

  /* --- The slip's wording, head or nurse ---------------------------------- */
  saveSlipText: (body: SlipText) => api.put<{ slipText: SlipText }>('/school/slip-text', body),
  resetSlipText: () => api.del<{ slipText: null }>('/school/slip-text'),

  /* Year levels and sections. Every change answers with the whole layout. */
  classes: () => api.get<{ grades: ApiGradeLevel[] }>('/classes'),
  addGrade: (name: string) => api.post<{ grades: ApiGradeLevel[] }>('/classes/grades', { name }),
  renameGrade: (id: string, name: string) => api.put<{ grades: ApiGradeLevel[] }>(`/classes/grades/${id}`, { name }),
  moveGrade: (id: string, direction: 'up' | 'down') =>
    api.post<{ grades: ApiGradeLevel[] }>(`/classes/grades/${id}/move`, { direction }),
  deleteGrade: (id: string) => api.del<{ grades: ApiGradeLevel[] }>(`/classes/grades/${id}`),
  addSection: (body: SectionBody) => api.post<{ grades: ApiGradeLevel[] }>('/classes/sections', body),
  updateSection: (id: string, body: SectionBody) =>
    api.put<{ grades: ApiGradeLevel[] }>(`/classes/sections/${id}`, body),
  deleteSection: (id: string) => api.del<{ grades: ApiGradeLevel[] }>(`/classes/sections/${id}`),

  /* --- A new school year, school head only ------------------------------ */
  schoolYear: () => api.get<ApiSchoolYear>('/school-year'),
  rollover: (body: RolloverBody) =>
    api.post<{
      ok: true
      schoolYear: string
      counts: { promoted: number; retained: number; completed: number; transferredOut: number; dropped: number }
    }>('/school-year/rollover', body),
  undoRollover: (rolloverId: string) =>
    api.post<{ ok: true; schoolYear: string }>('/school-year/undo', { rolloverId }),
  learner: (id: string) => api.get<{ learner: ApiLearnerRecord }>(`/learners/${id}`),
  /* Learners no longer on the roster, for their printed record. */
  formerLearners: () => api.get<{ learners: ApiFormerLearner[] }>('/learners/former'),
  /* Correcting a learner. The whole editable record in one request - see the
     note on EditLearnerBody. */
  updateLearner: (id: string, body: EditLearnerBody) =>
    api.put<{ ok: true }>(`/learners/${id}`, body),
  /* Removing a learner entered by mistake, and everything recorded against
     them. Permanent - see the note on the route. */
  deleteLearner: (id: string) => api.del<void>(`/learners/${id}`),
  /* What the registration dialog may offer: the school year and the
     classes this account may enrol into. */
  enrolmentOptions: () => api.get<ApiEnrolmentOptions>('/learners/options'),
  /* Registering a child. The LRN is typed rather than generated - see the
     note on the route. */
  enrolLearner: (body: NewLearnerBody) =>
    api.post<{ learner: { id: string; lrn: string; stubId: string } }>('/learners', body),
  /* A class list from a spreadsheet. LRNs already on file come back in
     `skipped` rather than failing the import. */
  importLearners: (body: ImportLearnersBody) =>
    api.post<{ added: number; skipped: string[] }>('/learners/import', body),

  /* Every weigh-in round on file, in scope - for the growth line. */
  measurements: () =>
    api.get<{
      measurements: { learnerId: string; measuredOn: string; heightCm: number; weightKg: number }[]
    }>('/measurements'),
  recordMeasurement: (learnerId: string, heightCm: number, weightKg: number, measuredOn: string, note?: string) =>
    api.post<{ ok: true; id: string }>('/measurements', {
      learnerId,
      heightCm,
      weightKg,
      measuredOn,
      note: note ?? '',
    }),
  withdrawMeasurement: (learnerId: string, measuredOn: string) =>
    api.del<void>(`/measurements/${learnerId}/${measuredOn}`),
  markAbsent: (learnerId: string, measuredOn: string) =>
    api.post<{ ok: true; id: string }>('/absences', { learnerId, measuredOn }),
  setImmunization: (
    learnerId: string,
    status: 'complete' | 'incomplete' | 'none',
    checkedOn: string,
  ) => api.post<{ ok: true; id: string }>('/immunizations', { learnerId, status, checkedOn }),
  setSlip: (learnerId: string, state: 'not-printed' | 'printed' | 'attended', at?: string) =>
    api.post<{ ok: true; id: string }>('/slips', { learnerId, state, at }),

  meeting: () => api.get<{ meeting: ApiMeeting | null }>('/meeting'),
  setMeeting: (date: string, time: string, venue: string) =>
    api.put<{ meeting: ApiMeeting }>('/meeting', { date, time, venue }),

  followUp: () => api.get<{ followUp: ApiFollowUp | null }>('/follow-up'),
  startFollowUp: (label: string, startedOn: string, learnerIds: string[]) =>
    api.post<{ followUp: ApiFollowUp }>('/follow-up', { label, startedOn, learnerIds }),
  endFollowUp: () => api.post<{ followUp: null }>('/follow-up/close', {}),

  activity: (limit = 20) => api.get<{ events: ApiActivity[] }>(`/activity?limit=${limit}`),

  /* --- Staff accounts, school head only -----------------------------------
     Every one of these is refused with 403 for the nurse's session. The
     Roles screen hides them as well, but the hiding is a courtesy and the
     403 is the guarantee. */
  staff: () => api.get<{ users: ApiStaff[] }>('/users'),
  createStaff: (body: {
    fullName: string
    password: string
    /** Derived from the full name when omitted. */
    username?: string
    role?: ApiRole
  }) => api.post<{ user: ApiStaff }>('/users', body),
  updateStaff: (
    id: string,
    body: {
      fullName?: string
      username?: string
      role?: ApiRole
      disabled?: boolean
    },
  ) => api.patch<{ user: ApiStaff }>(`/users/${id}`, body),
  /* Gone from the list and unable to sign in; the records it wrote keep its name. */
  deleteStaff: (id: string) => api.del<void>(`/users/${id}`),
  resetStaffPassword: (id: string, password: string) =>
    api.post<{ ok: true }>(`/users/${id}/password`, { password }),

  /* The signed-in user's own recovery codes, head or nurse. Plain text only
     in the response that creates them. */
  recoveryCodes: () =>
    api.get<{ total: number; remaining: number; createdAt: string | null }>('/auth/recovery-codes'),
  createRecoveryCodes: () => api.post<{ codes: string[] }>('/auth/recovery-codes'),
}
