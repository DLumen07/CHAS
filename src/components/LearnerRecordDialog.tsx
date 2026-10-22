import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Bandaids,
  ChalkboardTeacher,
  ChartLine,
  Eyedropper,
  FileText,
  FloppyDisk,
  GenderFemale,
  GenderMale,
  IdentificationCard,
  LockSimple,
  PencilSimple,
  Plus,
  Printer,
  Ruler,
  Table as TableIcon,
  Trash,
  Warning,
  type Icon,
} from '@phosphor-icons/react'
import { Button, cx } from './ui'
import { DiscardPrompt, Modal, ModalClose, ModalCloseButton, ModalContent, ModalDescription, ModalTitle } from './primitives'
import { RecordPreview } from './RecordPrint'
import { Journey, JourneyHeader, JourneyTiles } from './LearnerJourney'
import { HealthHistory, Immunization, InvitationSteps, NutritionDetails } from './LearnerDetails'
import { toast } from './toast'
import {
  COMMON_VACCINES,
  CONDITION_STATUSES,
  Choice,
  DOSE_STATUSES,
  ENROLMENT_STATUSES,
  Fieldset,
  FormRow,
  LABELS,
  NativeSelect,
  REQ,
  Readout,
  TextArea,
  TextInput,
} from './form'
import { GrowthChart, GrowthTable, type ZBand } from './GrowthChart'
import { growthPoints, growthRows } from '../lib/growth'
import type { Learner } from '../data/mock'
import { schoolIdentity, schoolYearStart, useSchoolInfo } from '../lib/school-year'
import {
  BAND_COLOR,
  ageInMonths,
  formatAge,
} from '../lib/nutrition'
import {
  ApiError,
  endpoints,
  type ApiCondition,
  type ApiDose,
  type ApiEnrolmentOptions,
  type ApiLearnerRecord,
  type ConditionStatus,
  type DoseStatus,
  type EditLearnerBody,
  type EnrolmentStatus,
} from '../lib/api'
import { refresh } from '../lib/server-records'
import { todayIso } from '../lib/dates'
import { cached } from '../lib/query'
import { nameError } from '../lib/names'

/* One learner, everything the school holds on them.

   THREE TABS RATHER THAN ONE SCROLL. This dialog used to be a single column
   that grew every time the record did: findings, then the health history,
   then the immunization card. A panel a reader has to scroll
   past three things to reach the fourth is a filing cabinet, not a record. The
   three tabs are the three questions somebody opens a child's record to answer
   - how are they, how have they changed, and what should we know.

   EDITING IS A MODE, NOT A SECOND DIALOG. A record you can read and a record
   you can correct are the same record, and a separate "edit learner" window
   would be a second copy of the registration form to keep in step. Edit swaps
   the body for the form, keeps the header, and Save is one request - see the
   note on the PUT route.

   THE CHARTS ARE FOUR PANELS, NOT ONE. See GrowthChart: height, weight, BMI
   and a z-score share no scale, and putting them on one pair of axes would
   need a second y-axis, which makes two lines cross wherever the author put
   the scales.
-------------------------------------------------------------------------- */

/** What the opener was looking at. The sheet has no tabs; 'growth' opens it
    with the growth charts already showing. */
type Tab = 'overview' | 'growth' | 'health'

/* The WHO BMI-for-age cut-offs, as grounds behind the z panel. These are the
   one place the clinical palette belongs on a chart in this app: here the
   colours ARE the bands rather than standing in for a series. */
export const Z_BANDS: ZBand[] = [
  { from: -9, to: -3, color: BAND_COLOR['Severely Wasted'], label: 'Severely wasted' },
  { from: -3, to: -2, color: BAND_COLOR.Wasted, label: 'Wasted' },
  /* The app's own cut-offs (lib/nutrition BMI_CUTOFFS), so the chart's
     grounds agree with the band printed beside it. */
  { from: -2, to: 2, color: BAND_COLOR.Normal, label: 'Normal' },
  { from: 2, to: 3, color: BAND_COLOR.Overweight, label: 'Overweight' },
  { from: 3, to: 9, color: BAND_COLOR.Obese, label: 'Obese' },
]

type Draft = {
  lrn: string
  lastName: string
  firstName: string
  middleName: string
  nameExt: string
  sex: 'M' | 'F'
  birthDate: string
  healthNotes: string
  sectionId: string
  enrolmentStatus: EnrolmentStatus
  conditions: (Omit<ApiCondition, 'recordedOn' | 'by'> & { key: string })[]
  doses: (Omit<ApiDose, 'by'> & { key: string })[]
}

function draftOf(r: ApiLearnerRecord): Draft {
  const current = r.enrolments[0]
  return {
    lrn: r.lrn,
    lastName: r.lastName,
    firstName: r.firstName,
    middleName: r.middleName,
    nameExt: r.nameExt,
    sex: r.sex,
    birthDate: r.birthDate ?? '',
    healthNotes: r.healthNotes,
    sectionId: r.sectionId,
    enrolmentStatus: current?.status ?? 'ENROLLED',
    conditions: r.conditions.map((c) => ({
      id: c.id,
      condition: c.condition,
      status: c.status,
      treatment: c.treatment,
      notes: c.notes,
      key: c.id,
    })),
    doses: r.vaccineDoses.map((d) => ({
      id: d.id,
      vaccine: d.vaccine,
      dose: d.dose,
      givenOn: d.givenOn,
      status: d.status,
      remarks: d.remarks,
      key: d.id,
    })),
  }
}

export function LearnerRecordDialog({
  learner,
  initialTab = 'overview',
  onWeighIn,
  onSlips,
  onSaved,
}: {
  learner: Learner
  /** Which question the opener was asking. The weigh-in station opens this on
      Growth, because that is what it was already showing. */
  initialTab?: Tab
  onWeighIn: (id: string) => void
  onSlips: (id: string) => void
  /** The roster has been pulled again; the screen behind may re-read it. */
  onSaved: () => void
}) {
  const l = learner
  const [record, setRecord] = useState<ApiLearnerRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [draft, setDraft] = useState<Draft | null>(null)
  const [options, setOptions] = useState<ApiEnrolmentOptions | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  /* Its own request rather than four more joins on the roster: GET /learners
     answers for all 182 children on every page load, and widening it so this
     panel can show one child's health history would make every list in the app pay
     for something open a few seconds at a time. */
  const [reloads, setReloads] = useState(0)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    void cached(`learner:${l.id}`, () => endpoints.learner(l.id))
      .then(({ learner: got }) => {
        if (!cancelled) {
          setRecord(got)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError('Unable to load this record.')
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [l.id, reloads])

  const editing = draft !== null
  /* The printable record, in a preview of its own over this one. */
  const [printing, setPrinting] = useState(false)

  /* Closing the record while editing asks first, so a stray click outside
     or the Escape key cannot throw away a half-finished correction. */
  const [askDiscard, setAskDiscard] = useState(false)
  const discarding = useRef(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  /** The scrolling body. Edit starts the form at its top, not wherever the
      sheet had been scrolled to. */
  const bodyRef = useRef<HTMLDivElement>(null)
  const guard = (e: { preventDefault: () => void }) => {
    if (editing && !discarding.current) {
      e.preventDefault()
      setAskDiscard(true)
    }
  }

  async function startEdit() {
    if (!record) return
    setSaveError(null)
    setFieldErrors({})
    setDraft(draftOf(record))
    bodyRef.current?.scrollTo({ top: 0 })
    if (!options) {
      try {
        setOptions(await endpoints.enrolmentOptions())
      } catch {
        /* The class picker is the only thing this feeds. Without it the form
           still edits everything else, and the picker falls back to a
           read-only readout. */
      }
    }
  }

  function validate(d: Draft): Record<string, string> {
    const e: Record<string, string> = {}
    if (!/^\d{12}$/.test(d.lrn)) e.lrn = 'The LRN must be 12 digits.'
    if (!d.lastName.trim()) e.lastName = 'The surname is required.'
    else if (nameError(d.lastName, 'surname')) e.lastName = nameError(d.lastName, 'surname')!
    if (!d.firstName.trim()) e.firstName = 'The first name is required.'
    else if (nameError(d.firstName, 'first name')) e.firstName = nameError(d.firstName, 'first name')!
    if (nameError(d.middleName, 'middle name')) e.middleName = nameError(d.middleName, 'middle name')!
    if (nameError(d.nameExt, 'name extension')) e.nameExt = nameError(d.nameExt, 'name extension')!
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.birthDate)) e.birthDate = 'Enter the date of birth.'
    d.conditions.forEach((c, i) => {
      if (!c.condition.trim()) e[`c${i}`] = 'Enter the condition.'
    })
    d.doses.forEach((x, i) => {
      if (!x.vaccine.trim() || !x.dose.trim()) e[`d${i}`] = 'Enter the vaccine and the dose.'
    })
    return e
  }

  async function save() {
    if (!draft) return
    const e = validate(draft)
    setFieldErrors(e)
    if (Object.keys(e).length) {
      setSaveError('Complete the required fields.')
      return
    }
    setSaveError(null)
    setSaving(true)

    const body: EditLearnerBody = {
      lrn: draft.lrn,
      lastName: draft.lastName.trim(),
      firstName: draft.firstName.trim(),
      middleName: draft.middleName.trim() || undefined,
      nameExt: draft.nameExt.trim() || undefined,
      sex: draft.sex,
      birthDate: draft.birthDate,
      healthNotes: draft.healthNotes.trim() || undefined,
      sectionId: options ? draft.sectionId || undefined : undefined,
      enrolmentStatus: draft.enrolmentStatus,
      conditions: draft.conditions.map((c) => ({
        id: c.id || undefined,
        condition: c.condition.trim(),
        status: c.status,
        treatment: c.treatment.trim(),
        notes: c.notes.trim(),
      })),
      doses: draft.doses.map((d) => ({
        id: d.id || undefined,
        vaccine: d.vaccine.trim(),
        dose: d.dose.trim(),
        givenOn: d.givenOn || undefined,
        status: d.status,
        remarks: d.remarks.trim(),
      })),
    }

    try {
      await endpoints.updateLearner(l.id, body)
      /* The roster carries the name, the section and the birth date this edit
         may have changed, so it is pulled again rather than patched by hand -
         the same rule registration follows. */
      await refresh()
      onSaved()
      setDraft(null)
      setReloads((n) => n + 1)
      toast.success(`${l.firstName} ${l.lastName}’s record was updated.`)
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Unable to save changes.')
    } finally {
      setSaving(false)
    }
  }

  /* Deleting asks first, over the record, the same way discarding an edit
     does. It is for a learner entered by mistake - see the note on the
     DELETE route - so the prompt says what goes with them. */
  const [askDelete, setAskDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function remove() {
    setSaveError(null)
    setDeleting(true)
    try {
      await endpoints.deleteLearner(l.id)
      /* Pulled again, not patched: the learner leaves every count on every
         screen, and the roster is what those are counted from. Once it
         lands the screen behind no longer has this learner to show, and the
         record closes. */
      await refresh()
      onSaved()
      setAskDelete(false)
      closeRef.current?.click()
      toast.success(`${l.firstName} ${l.lastName} was deleted.`)
    } catch (err) {
      setAskDelete(false)
      setSaveError(err instanceof ApiError ? err.message : 'Unable to delete this learner.')
    } finally {
      setDeleting(false)
    }
  }

  /* --- The sheet -------------------------------------------------------- */

  return (
    <ModalContent
      className="h-[min(92vh,860px)] max-w-[920px]"
      /* Put focus back on the card that opened this rather than letting Radix
         guess. It restores to its own trigger, and this dialog has none - it
         is opened by whichever of thirty cards was clicked - so the restore
         was landing on <body>, dropping a keyboard user thirty tab stops from
         where they were. */
      onCloseAutoFocus={(e) => {
        e.preventDefault()
        document.querySelector<HTMLElement>(`[data-learner="${l.id}"]`)?.focus()
      }}
      onEscapeKeyDown={guard}
      onPointerDownOutside={guard}
    >
      <DiscardPrompt
        open={askDiscard}
        onKeep={() => setAskDiscard(false)}
        onDiscard={() => {
          setAskDiscard(false)
          discarding.current = true
          setDraft(null)
          closeRef.current?.click()
          discarding.current = false
        }}
      />
      {askDelete && (
        <DeletePrompt
          name={`${l.firstName} ${l.lastName}`}
          deleting={deleting}
          onKeep={() => setAskDelete(false)}
          onDelete={() => void remove()}
        />
      )}
      <ModalClose ref={closeRef} className="hidden" tabIndex={-1} aria-hidden />
      {/* The sheet prints the name as its heading; the dialog still needs its
          own accessible title, present while the record is loading too. */}
      <ModalTitle className="sr-only">
        {l.lastName}, {l.firstName}
      </ModalTitle>
      <ModalDescription className="sr-only">
        LRN {l.lrn} &middot; {l.section}
      </ModalDescription>

      {/* --- The strip: what this document is, and its actions ----------- */}
      <header
        className={cx(
          'flex shrink-0 items-center gap-2.5 border-b px-6 py-3',
          editing ? 'border-gold-400 bg-gold-100' : 'border-line bg-wash',
        )}
      >
        {editing ? (
          <p className="flex min-w-0 flex-1 items-center gap-2 text-[12.5px] font-medium text-gold-700">
            <PencilSimple size={14} weight="fill" className="shrink-0" />
            Editing this record. Changes are not saved until you select Save changes.
          </p>
        ) : (
          <p className="min-w-0 flex-1 truncate text-[12.5px] text-muted">
            <span className="font-semibold text-navy-900">Learner health record</span>
            {' · '}
            {schoolIdentity().name}
            {record?.enrolments[0]?.schoolYear ? ` · S.Y. ${record.enrolments[0].schoolYear}` : ''}
          </p>
        )}
        {!editing && record && (
          <Button
            className="h-8 shrink-0 px-3 text-[12.5px]"
            icon={<Printer size={13} weight="bold" />}
            onClick={() => setPrinting(true)}
          >
            Print record
          </Button>
        )}
        {!editing && record && (
          <Button
            className="h-8 shrink-0 px-3 text-[12.5px]"
            icon={<PencilSimple size={13} weight="bold" />}
            onClick={() => void startEdit()}
          >
            Edit
          </Button>
        )}
        <ModalCloseButton label="Close record" onClick={guard} />
      </header>

      <div ref={bodyRef} className="min-h-0 flex-1 overflow-auto px-8 py-6">
        {loading && <Note>Loading record&hellip;</Note>}
        {loadError && <Alert>{loadError}</Alert>}

        {record && draft && (
          <EditForm
            draft={draft}
            setDraft={setDraft}
            options={options}
            errors={fieldErrors}
            schoolYear={record.enrolments[0]?.schoolYear ?? options?.schoolYear ?? ''}
          />
        )}

        {record && !draft && (
          <Sheet learner={l} record={record} openCharts={initialTab === 'growth'} />
        )}
      </div>

      <footer className="shrink-0 border-t border-line px-8 py-4">
        {saveError && <Alert className="mb-3">{saveError}</Alert>}
        <div className="flex items-center justify-end gap-2.5">
          {!editing && record && (
            <button
              type="button"
              onClick={() => setAskDelete(true)}
              className="mr-auto flex h-10 items-center gap-1.5 rounded-[10px] px-3 text-[12.5px] font-medium text-[#9f1239] transition-colors duration-100 hover:bg-[#fdf2f5]"
            >
              <Trash size={14} weight="bold" />
              Delete learner
            </button>
          )}
          {editing ? (
            <>
              <Button className="h-10 px-5" onClick={() => setDraft(null)} disabled={saving}>
                Cancel
              </Button>
              <Button
                variant="primary"
                className="h-10 rounded-[10px] px-6 text-[13px] font-semibold"
                icon={<FloppyDisk size={14} weight="bold" />}
                onClick={() => void save()}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
            </>
          ) : (
            <>
              <Button
                className="h-10 px-4 text-[13px]"
                icon={<FileText size={14} weight="bold" />}
                onClick={() => onSlips(l.id)}
              >
                {l.slip === 'not-printed' ? 'Print invitation slip' : 'View slip'}
              </Button>
              <Button
                variant="primary"
                className="h-10 rounded-[10px] px-5 text-[13px] font-semibold"
                icon={<Ruler size={14} weight="bold" />}
                onClick={() => onWeighIn(l.id)}
              >
                {l.measuredOn ? 'Correct measurement' : 'Record measurement'}
              </Button>
            </>
          )}
        </div>
      </footer>

      <Modal open={printing} onOpenChange={setPrinting}>
        {printing && <RecordPreview learnerId={l.id} onClose={() => setPrinting(false)} />}
      </Modal>
    </ModalContent>
  )
}

/* --- The sheet -------------------------------------------------------------

   On top since 2026-10-19, the school year as one line (LearnerJourney.tsx):
   the weigh-ins, the slip, the parent's attendance and the next step. Under
   it since 2026-10-21, the record in detail as cards (LearnerDetails.tsx):
   where the learner sits on each WHO scale, how the figures moved this year,
   every weigh-in with the nurse's note, the invitation, the health history
   and the immunization card. One page to read top to bottom, no tabs. */

function Sheet({
  learner: l,
  record,
  openCharts,
}: {
  learner: Learner
  record: ApiLearnerRecord
  openCharts: boolean
}) {
  const { advisers, schoolYear } = useSchoolInfo()
  const [charts, setCharts] = useState(openCharts)
  const rowsAsc = useMemo(() => growthRows(record), [record])

  const enrolment = record.enrolments[0]
  const year = enrolment?.schoolYear ?? schoolYear

  return (
    <div className="space-y-5">
      {/* --- The school-year journey (option C, 2026-10-19) ------------ */}
      <div className="space-y-4">
        <JourneyHeader learner={l} record={record} adviser={advisers[l.section] ?? ''} />
        <Journey learner={l} record={record} schoolYear={year} />
        <JourneyTiles learner={l} record={record} schoolYear={year} />
      </div>

      <h3 className="border-t border-line pt-5 font-display text-[12px] font-extrabold tracking-[0.06em] text-muted uppercase">
        Record details
      </h3>

      {/* --- Particulars ----------------------------------------------- */}
      <table className="w-full border-collapse text-[13px]">
        <tbody>
          <tr>
            <Cell k="LRN" v={l.lrn} mono />
            <Cell k="Date of birth" v={record.birthDate ? mdy(record.birthDate) : '—'} />
            <Cell k="Sex" v={l.sex === 'M' ? 'Male' : 'Female'} />
          </tr>
          <tr>
            <Cell k="Age" v={formatAge(ageInMonths(l.birthDate, todayISO()))} />
            <Cell k="Year level" v={enrolment?.gradeName ?? l.gradeName ?? '—'} />
            <Cell k="Enrolment" v={enrolment ? LABELS.enrolment[enrolment.status] : '—'} />
          </tr>
        </tbody>
      </table>

      <NutritionDetails
        record={record}
        rows={rowsAsc}
        schoolYearStart={schoolYearStart(year)}
        charts={
          <>
            <button
              type="button"
              onClick={() => setCharts((v) => !v)}
              aria-expanded={charts}
              className="flex items-center gap-1.5 rounded-[8px] px-1 py-1 text-[12.5px] font-semibold text-navy-700 transition-colors duration-100 hover:text-navy-900"
            >
              <ChartLine size={14} weight="bold" />
              {charts ? 'Hide growth charts' : 'Show growth charts'}
            </button>
            {charts && <Growth record={record} />}
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        <InvitationSteps learner={l} />
        <HealthHistory record={record} />
      </div>

      <Immunization learner={l} record={record} />
    </div>
  )
}

/** The forms' own date order, whatever the machine's locale. */
function mdy(iso: string): string {
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${m}/${d}/${y}` : iso
}

/** One label and value of the particulars table. */
function Cell({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <>
      <th
        scope="row"
        className="w-[14%] border border-line bg-canvas px-3 py-2.5 text-left font-semibold whitespace-nowrap text-muted"
      >
        {k}
      </th>
      <td
        className={cx(
          'border border-line px-3 py-2.5 font-semibold text-navy-900',
          mono && 'font-mono tracking-[0.02em]',
        )}
      >
        {v}
      </td>
    </>
  )
}

/* --- Growth --------------------------------------------------------------- */

/* Every save ever made against this learner, under the charts.
 *
 * WHY IT IS HERE RATHER THAN A TAB OF ITS OWN. It answers a question about
 * the series directly above it - "why does Tuesday say 132.4 when I remember
 * typing 128" - and a reader who has to go and find it somewhere else will
 * not think to. It sits under the charts rather than over them because the
 * figures are what the record is for and this is how they came to be.
 *
 * WHAT MAKES IT WORTH KEEPING. The measurement table holds one row per
 * session, so a correction replaces rather than accumulates - right for the
 * SF8, and it used to mean the previous figure vanished. Every write now
 * appends here first, in the same transaction, so this list cannot be missing
 * a change that landed. Nothing in it is ever edited or removed.
 */
function Recordings({ record }: { record: ApiLearnerRecord }) {
  const rows = record.recordings ?? []
  if (rows.length === 0) return null

  /* Only worth showing when it says something the charts do not. A learner
     weighed once per session has one entry per reading and this panel would
     be the same list twice. */
  const interesting = rows.some((r) => r.kind !== 'RECORDED')

  return (
    <details className="mt-4 rounded-[12px] bg-wash px-3.5 py-2.5" open={interesting}>
      <summary className="cursor-pointer text-[11.5px] font-medium text-navy-900 select-none">
        Recording history
        <span className="ml-1.5 font-normal text-muted">
          {rows.length} {rows.length === 1 ? 'entry' : 'entries'}
          {interesting ? ' · includes a correction' : ''}
        </span>
      </summary>

      <p className="mt-2 text-[10.5px] leading-relaxed text-muted">
        All saved measurements, newest first, including corrections.
      </p>

      <ul className="mt-2 space-y-1">
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex items-baseline gap-2 rounded-[9px] bg-white px-2.5 py-1.5 text-[11px]"
          >
            <span
              className={cx(
                'shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold',
                r.kind === 'WITHDRAWN'
                  ? 'bg-[#fdf0ef] text-[#a4262c]'
                  : r.kind === 'CORRECTED'
                    ? 'bg-gold-100 text-gold-700'
                    : 'bg-navy-50 text-navy-700',
              )}
            >
              {r.kind === 'WITHDRAWN'
                ? 'Withdrawn'
                : r.kind === 'CORRECTED'
                  ? 'Corrected'
                  : 'Recorded'}
            </span>
            <span className="tnum min-w-0 flex-1 text-navy-900">
              {r.heightCm === null || r.weightKg === null ? (
                <span className="text-muted">measurement removed</span>
              ) : (
                <>
                  {r.heightCm.toFixed(1)} cm &middot; {r.weightKg.toFixed(1)} kg
                </>
              )}
              <span className="text-muted"> for {r.measuredOn ?? 'an unknown date'}</span>
            </span>
            <span className="shrink-0 text-[10px] whitespace-nowrap text-placeholder">
              {new Date(r.at).toLocaleDateString()}{' '}
              {new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {' · '}
              {r.by}
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}

function Growth({ record }: { record: ApiLearnerRecord }) {
  const [hover, setHover] = useState<number | null>(null)
  const [asTable, setAsTable] = useState(false)

  const rows = useMemo(() => growthRows(record), [record])

  if (rows.length === 0) {
    return (
      <NotOnFile>
        No measurements recorded.
      </NotOnFile>
    )
  }

  return (
    <div>
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11.5px] text-muted">
          <span className="tnum font-semibold text-navy-900">{rows.length}</span>{' '}
          {rows.length === 1 ? 'reading' : 'readings'}, oldest first.
        </p>
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          className="flex items-center gap-1.5 rounded-full bg-wash px-2.5 py-1 text-[11px] font-medium text-navy-800 transition-colors duration-100 hover:bg-navy-50"
        >
          {asTable ? <ChartLine size={12} weight="bold" /> : <TableIcon size={12} weight="bold" />}
          {asTable ? 'Show charts' : 'Show table'}
        </button>
      </div>

      {asTable ? (
        <GrowthTable rows={rows} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <GrowthChart
            title="Height"
            unit="cm"
            points={growthPoints(rows, 'height')}
            hover={hover}
            onHover={setHover}
          />
          <GrowthChart
            title="Weight"
            unit="kg"
            points={growthPoints(rows, 'weight')}
            hover={hover}
            onHover={setHover}
          />
          <GrowthChart
            title="BMI"
            points={growthPoints(rows, 'bmi')}
            hover={hover}
            onHover={setHover}
          />
          <GrowthChart
            title="BMI-for-age z"
            points={growthPoints(rows, 'z')}
            decimals={2}
            bands={Z_BANDS}
            hover={hover}
            onHover={setHover}
          />
        </div>
      )}

      <Recordings record={record} />

      {!asTable && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 rounded-[10px] bg-wash px-3.5 py-2.5">
          <span className="text-[10px] font-semibold tracking-[0.06em] text-muted uppercase">
            z-score bands
          </span>
          {Z_BANDS.map((b) => (
            <span key={b.label} className="flex items-center gap-1.5 text-[10.5px] text-muted">
              <span
                aria-hidden
                className="size-2.5 rounded-[3px]"
                style={{ background: b.color, opacity: 0.35 }}
              />
              {b.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/* --- The edit form -------------------------------------------------------- */

function EditForm({
  draft,
  setDraft,
  options,
  errors,
  schoolYear,
}: {
  draft: Draft
  setDraft: (d: Draft) => void
  options: ApiEnrolmentOptions | null
  errors: Record<string, string>
  schoolYear: string
}) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v })
  const section = options?.sections.find((s) => s.id === draft.sectionId)
  const newKey = () => crypto.randomUUID()

  return (
    <div className="space-y-7">
      <EditGroup icon={IdentificationCard} title="Learner information">
        <FormRow>
          <TextInput
            label={<>LRN{REQ}</>}
            hint="Must be unique to this learner."
            value={draft.lrn}
            onChange={(v) => set('lrn', v.replace(/\D/g, '').slice(0, 12))}
            error={errors.lrn}
            inputMode="numeric"
            className="font-mono tracking-[0.04em]"
          />
          <TextInput
            label={<>Date of birth{REQ}</>}
            type="date"
            max={todayISO()}
            value={draft.birthDate}
            onChange={(v) => set('birthDate', v)}
            error={errors.birthDate}
          />
        </FormRow>
        <FormRow>
          <TextInput
            label={<>First name{REQ}</>}
            value={draft.firstName}
            onChange={(v) => set('firstName', v)}
            error={errors.firstName}
          />
          <TextInput
            label="Middle name"
            value={draft.middleName}
            onChange={(v) => set('middleName', v)}
            error={errors.middleName}
          />
        </FormRow>
        <FormRow>
          <TextInput
            label={<>Last name{REQ}</>}
            value={draft.lastName}
            onChange={(v) => set('lastName', v)}
            error={errors.lastName}
          />
          <TextInput
            label="Name extension"
            value={draft.nameExt}
            onChange={(v) => set('nameExt', v.slice(0, 16))}
            placeholder="Jr."
            error={errors.nameExt}
          />
        </FormRow>
        <Fieldset label={<>Sex{REQ}</>}>
          <div className="grid max-w-[320px] grid-cols-2 gap-2">
            {(['F', 'M'] as const).map((s) => (
              <Choice key={s} pressed={draft.sex === s} onClick={() => set('sex', s)}>
                {s === 'F' ? <GenderFemale size={15} /> : <GenderMale size={15} />}
                {s === 'F' ? 'Female' : 'Male'}
              </Choice>
            ))}
          </div>
        </Fieldset>
      </EditGroup>

      <EditGroup icon={ChalkboardTeacher} title="Current enrolment">
        <FormRow>
          <Readout
            label="School year"
            hint="Set for the whole school."
            lock={<LockSimple size={11} weight="fill" className="text-placeholder" />}
          >
            <span className="tnum text-[13px] font-semibold text-navy-900">
              {schoolYear || '—'}
            </span>
          </Readout>

          {!options ? (
            <Readout
              label="Class"
              hint="Unable to load the class list."
              lock={<LockSimple size={11} weight="fill" className="text-placeholder" />}
            >
              <span className="text-[13px] font-semibold text-navy-900">
                {section?.name ?? '—'}
              </span>
            </Readout>
          ) : (
            <Fieldset label="Grade level and section" hint="Changes the learner’s class.">
              <NativeSelect
                value={draft.sectionId}
                onChange={(v) => set('sectionId', v)}
              >
                {options?.sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name === s.gradeName ? s.name : `${s.gradeName} · ${s.name}`}
                  </option>
                ))}
              </NativeSelect>
            </Fieldset>
          )}
        </FormRow>

        <FormRow>
          <Fieldset label="Enrolment status">
            <NativeSelect
              value={draft.enrolmentStatus}
              onChange={(v) => set('enrolmentStatus', v as EnrolmentStatus)}
            >
              {ENROLMENT_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </NativeSelect>
          </Fieldset>
        </FormRow>
      </EditGroup>

      <EditGroup
        icon={Bandaids}
        title="Health history"
        add="Add a condition"
        onAdd={() =>
          set('conditions', [
            ...draft.conditions,
            {
              key: newKey(),
              id: '',
              condition: '',
              status: 'UNKNOWN' as ConditionStatus,
              treatment: '',
              notes: '',
            },
          ])
        }
      >
        <TextArea
          label="Important health notes"
          hint="Anything staff should know, such as allergies or limits on physical activity."
          value={draft.healthNotes}
          onChange={(v) => set('healthNotes', v)}
          rows={3}
        />

        {draft.conditions.map((c, i) => (
          <EditCard
            key={c.key}
            error={errors[`c${i}`]}
            onRemove={() =>
              set(
                'conditions',
                draft.conditions.filter((x) => x.key !== c.key),
              )
            }
          >
            <FormRow>
              <TextInput
                label={<>Condition{REQ}</>}
                value={c.condition}
                onChange={(v) =>
                  set(
                    'conditions',
                    draft.conditions.map((x) => (x.key === c.key ? { ...x, condition: v } : x)),
                  )
                }
                dense
              />
              <Fieldset label="Status" dense>
                <NativeSelect
                  dense
                  value={c.status}
                  onChange={(v) =>
                    set(
                      'conditions',
                      draft.conditions.map((x) =>
                        x.key === c.key ? { ...x, status: v as ConditionStatus } : x,
                      ),
                    )
                  }
                >
                  {CONDITION_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </NativeSelect>
              </Fieldset>
            </FormRow>
            <TextArea
              label="Treatment or medication"
              value={c.treatment}
              onChange={(v) =>
                set(
                  'conditions',
                  draft.conditions.map((x) => (x.key === c.key ? { ...x, treatment: v } : x)),
                )
              }
              rows={2}
            />
          </EditCard>
        ))}
      </EditGroup>

      <EditGroup
        icon={Eyedropper}
        title="Immunization card"
        add="Add immunization"
        onAdd={() =>
          set('doses', [
            ...draft.doses,
            {
              key: newKey(),
              id: '',
              vaccine: '',
              dose: '1',
              givenOn: null,
              status: 'GIVEN' as DoseStatus,
              remarks: '',
            },
          ])
        }
      >
        {draft.doses.length === 0 && <NotOnFile>No vaccines recorded.</NotOnFile>}
        <datalist id="chas-vaccines-edit">
          {COMMON_VACCINES.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
        {draft.doses.map((d, i) => (
          <EditCard
            key={d.key}
            error={errors[`d${i}`]}
            onRemove={() =>
              set(
                'doses',
                draft.doses.filter((x) => x.key !== d.key),
              )
            }
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <TextInput
                label={<>Vaccine{REQ}</>}
                value={d.vaccine}
                onChange={(v) =>
                  set(
                    'doses',
                    draft.doses.map((x) => (x.key === d.key ? { ...x, vaccine: v } : x)),
                  )
                }
                list="chas-vaccines-edit"
                dense
              />
              <TextInput
                label={<>Dose{REQ}</>}
                value={d.dose}
                onChange={(v) =>
                  set(
                    'doses',
                    draft.doses.map((x) => (x.key === d.key ? { ...x, dose: v } : x)),
                  )
                }
                dense
              />
              <TextInput
                label="Date given"
                type="date"
                max={todayISO()}
                value={d.givenOn ?? ''}
                onChange={(v) =>
                  set(
                    'doses',
                    draft.doses.map((x) => (x.key === d.key ? { ...x, givenOn: v || null } : x)),
                  )
                }
                dense
              />
              <Fieldset label="Status" dense>
                <NativeSelect
                  dense
                  value={d.status}
                  onChange={(v) =>
                    set(
                      'doses',
                      draft.doses.map((x) =>
                        x.key === d.key ? { ...x, status: v as DoseStatus } : x,
                      ),
                    )
                  }
                >
                  {DOSE_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </NativeSelect>
              </Fieldset>
            </div>
            <TextInput
              label="Remarks"
              value={d.remarks}
              onChange={(v) =>
                set(
                  'doses',
                  draft.doses.map((x) => (x.key === d.key ? { ...x, remarks: v } : x)),
                )
              }
              dense
            />
          </EditCard>
        ))}
      </EditGroup>
    </div>
  )
}

/* --- Small pieces --------------------------------------------------------- */

/* Local, not UTC: in the Philippines toISOString() is still yesterday
   until eight in the morning. */
function todayISO() {
  return todayIso()
}

function EditGroup({
  icon: Glyph,
  title,
  add,
  onAdd,
  children,
}: {
  icon: Icon
  title: string
  add?: string
  onAdd?: () => void
  children: ReactNode
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-navy-50">
          <Glyph size={14} weight="fill" className="text-navy-700" />
        </span>
        <h3 className="font-display text-[14px] font-bold tracking-[-0.02em] text-navy-900">
          {title}
        </h3>
        {add && onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="ml-auto flex items-center gap-1.5 rounded-full bg-wash px-2.5 py-1 text-[11px] font-medium text-navy-800 transition-colors duration-100 hover:bg-navy-50"
          >
            <Plus size={12} weight="bold" />
            {add}
          </button>
        )}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

/** One removable row of a repeating list. */
function EditCard({
  badge,
  error,
  onRemove,
  children,
}: {
  badge?: string
  error?: string
  onRemove: () => void
  children: ReactNode
}) {
  return (
    <div
      className={cx(
        'rounded-[12px] bg-canvas p-3.5',
        error
          ? 'shadow-[inset_0_0_0_1px_#c4708a]'
          : 'shadow-[inset_0_0_0_1px_var(--color-line)]',
      )}
    >
      <div className="mb-2.5 flex items-center gap-2">
        {badge && (
          <span className="rounded-full bg-navy-50 px-2 py-0.5 text-[9.5px] font-semibold tracking-[0.04em] text-navy-800 uppercase">
            {badge}
          </span>
        )}
        {error && <span className="text-[11px] font-medium text-[#9f1239]">{error}</span>}
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove this row"
          className="ml-auto grid size-7 place-items-center rounded-[8px] text-muted transition-colors duration-100 hover:bg-[#fdf2f5] hover:text-[#9f1239]"
        >
          <Trash size={13} weight="bold" />
        </button>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

/* "Are you sure" over the record, shaped like the discard prompt. Keep is the
   focused button, so Enter on a stray keypress keeps the learner. */
function DeletePrompt({
  name,
  deleting,
  onKeep,
  onDelete,
}: {
  name: string
  deleting: boolean
  onKeep: () => void
  onDelete: () => void
}) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Delete this learner?"
      className="absolute inset-0 z-20 grid place-items-center bg-white/70 backdrop-blur-[1px]"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          if (!deleting) onKeep()
        }
      }}
    >
      <div className="w-[400px] max-w-[90%] rounded-[16px] bg-white p-5 shadow-[0_18px_50px_-12px_rgba(4,12,36,0.45),0_0_0_1px_rgba(14,36,100,0.08)]">
        <h3 className="text-[15px] font-semibold text-navy-900">Delete {name}?</h3>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
          This permanently removes the learner and everything recorded for them: measurements, invitation
          slips, attendance, health history and immunization card. It cannot be undone.
        </p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
          Use this only for a learner added by mistake or added twice.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="h-9 rounded-[10px] px-3.5 text-[12.5px] font-medium text-[#9f1239] transition-colors duration-100 hover:bg-[#fdf2f5] disabled:opacity-60"
          >
            {deleting ? 'Deleting…' : 'Delete learner'}
          </button>
          <button
            type="button"
            autoFocus
            onClick={onKeep}
            disabled={deleting}
            className="h-9 rounded-[10px] bg-navy-900 px-3.5 text-[12.5px] font-semibold text-white transition-colors duration-100 hover:bg-navy-800 disabled:opacity-60"
          >
            Keep learner
          </button>
        </div>
      </div>
    </div>
  )
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[12px] bg-wash px-3.5 py-3 text-[12px] leading-relaxed text-muted">
      {children}
    </p>
  )
}

function NotOnFile({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[12px] border border-dashed border-line bg-wash px-3.5 py-3 text-[12px] leading-relaxed text-muted">
      {children}
    </p>
  )
}

function Alert({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      role="alert"
      className={cx(
        'flex items-center gap-2 rounded-[10px] bg-[#fdf2f5] px-3.5 py-2.5 text-[12px] font-medium text-[#9f1239]',
        className,
      )}
    >
      <Warning size={14} weight="fill" className="shrink-0" />
      {children}
    </p>
  )
}
