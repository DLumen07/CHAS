import { useMemo, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  CaretLeft,
  CaretRight,
  Check,
  FilePdf,
  Info,
  MagnifyingGlass,
  Printer,
  Warning,
  X,
} from '@phosphor-icons/react'
import { ConfirmDialog, Modal, ModalCloseButton, ModalContent, ModalDescription, ModalTitle } from './primitives'
import { PILL, PILL_OFF, PILL_ON, cx } from './ui'
import { Y } from './bento'
import SlipSheet, { meetingDateText } from './SlipSheet'
import { TODAY, fullName, type Learner } from '@/data/mock'
import { useRoster, type Meeting } from '@/lib/records'
import { formatDate } from '@/lib/dates'

/* The print wizard, opened from the slips page.

   A narrow dialog that asks one question per step, with a thin progress bar
   on top - chosen by the user from three drafts (2026-10-08):

   1. When is the parent meeting?   date, time, venue
   2. Who should get a slip?        ticked learners; the uninvited are ticked
   3. Ready to print                read each sheet, then print or save a PDF

   The dialog only collects. Printing is the page's job (`onIssue`), because
   the sheets are rendered into #print-root outside this tree. */

export type IssueMode = 'paper' | 'pdf'

export interface WizardStart {
  /** Opened for one learner (a reprint, or from their record). */
  learnerId?: string
}

type Step = 1 | 2 | 3

export default function SlipWizard({
  open,
  onOpenChange,
  start,
  busy,
  onIssue,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  start: WizardStart
  busy: boolean
  onIssue: (mode: IssueMode, sheets: Learner[]) => void
}) {
  return (
    <Modal open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      {open && (
        <ModalContent className="max-h-[min(90vh,820px)] max-w-[560px]">
          {/* Mounted per opening, so every batch starts clean. */}
          <Wizard start={start} busy={busy} onIssue={onIssue} />
        </ModalContent>
      )}
    </Modal>
  )
}

function Wizard({
  start,
  busy,
  onIssue,
}: {
  start: WizardStart
  busy: boolean
  onIssue: (mode: IssueMode, sheets: Learner[]) => void
}) {
  const { learners, meeting, setMeeting, error, clearError } = useRoster()
  const flagged = useMemo(
    () => learners.filter((l) => l.measuredOn && (l.bmiBand !== 'Normal' || l.hfaBand !== 'Normal')),
    [learners],
  )
  const meetingOk = Boolean(meeting && meeting.date >= TODAY)

  const [step, setStep] = useState<Step>(() => (start.learnerId ? (meetingOk ? 3 : 1) : 1))

  /* --- 1. Meeting -------------------------------------------------------
     A past meeting keeps its time and venue, which rarely change from one
     meeting to the next, but not its date. */
  const [draft, setDraft] = useState<Meeting>(() =>
    meeting ? { ...meeting, date: meeting.date >= TODAY ? meeting.date : '' } : { date: '', time: '', venue: '' },
  )
  const [tried, setTried] = useState(false)
  const datePast = draft.date !== '' && draft.date < TODAY
  const missing = { date: !draft.date.trim(), time: !draft.time.trim(), venue: !draft.venue.trim() }
  const draftOk = !missing.date && !missing.time && !missing.venue && !datePast

  /* --- 2. Learners ------------------------------------------------------ */
  const [picked, setPicked] = useState<Set<string>>(() =>
    start.learnerId
      ? new Set([start.learnerId])
      : new Set(flagged.filter((l) => l.slip === 'not-printed').map((l) => l.id)),
  )
  const [scope, setScope] = useState<'new' | 'all'>(start.learnerId ? 'all' : 'new')
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const rows = flagged.filter((l) => {
    if (scope === 'new' && l.slip !== 'not-printed') return false
    return !needle || fullName(l).toLowerCase().includes(needle) || l.lrn.includes(needle)
  })
  const selected = flagged.filter((l) => picked.has(l.id))
  const inView = rows.filter((l) => picked.has(l.id)).length
  const allInView = rows.length > 0 && inView === rows.length
  const newCount = flagged.filter((l) => l.slip === 'not-printed').length

  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const toggleAll = () =>
    setPicked((p) => {
      const next = new Set(p)
      rows.forEach((l) => (allInView ? next.delete(l.id) : next.add(l.id)))
      return next
    })

  /* --- 3. Review --------------------------------------------------------
     Opened for a learner who measured normal: no letter to send, so the
     sheet is shown as a preview and nothing prints. */
  const startLearner = start.learnerId ? learners.find((l) => l.id === start.learnerId) : undefined
  const previewOnly = startLearner && !flagged.some((l) => l.id === startLearner.id) ? startLearner : undefined
  const [at, setAt] = useState(0)
  const n = selected.length
  const sheet = selected[Math.min(at, Math.max(n - 1, 0))] ?? previewOnly
  const flip = (by: 1 | -1) => n > 1 && setAt((i) => (Math.min(i, n - 1) + by + n) % n)

  /* --- Navigation ------------------------------------------------------- */
  const [confirmMove, setConfirmMove] = useState(false)
  function applyMeeting() {
    clearError()
    setMeeting({ date: draft.date, time: draft.time.trim(), venue: draft.venue.trim() })
  }

  function next() {
    if (step === 1) {
      setTried(true)
      if (!draftOk) return
      const changed = !meeting || meeting.date !== draft.date || meeting.time !== draft.time || meeting.venue !== draft.venue
      if (changed && meeting && waitingParents(learners) > 0) {
        setConfirmMove(true)
        return
      }
      if (changed) applyMeeting()
      setStep(2)
    } else if (step === 2 && n > 0) {
      setAt(0)
      setStep(3)
    }
  }
  const canIssue = meetingOk && n > 0 && !busy

  const head = {
    1: { title: 'Parent meeting', sub: 'The date, time and venue printed on each slip.' },
    2: { title: 'Select learners', sub: 'Flagged learners without an invitation are selected.' },
    3: {
      title: previewOnly && n === 0 ? 'Slip preview' : `Ready to print ${n} slip${n === 1 ? '' : 's'}`,
      sub:
        previewOnly && n === 0
          ? `${fullName(previewOnly)} has a normal nutritional status. No invitation is required.`
          : 'Review the slips, then print or save as PDF.',
    },
  }[step]

  return (
    <>
      <MeetingChangeConfirm
        open={confirmMove}
        onOpenChange={setConfirmMove}
        waiting={waitingParents(learners)}
        onConfirm={() => {
          setConfirmMove(false)
          applyMeeting()
          setStep(2)
        }}
      />
      <header className="shrink-0 px-6 pt-5">
        <div className="flex gap-1.5" aria-hidden>
          {[1, 2, 3].map((s) => (
            <span
              key={s}
              className={cx('h-1 flex-1 rounded-full transition-colors duration-200', s <= step ? 'bg-navy-600' : 'bg-line')}
            />
          ))}
        </div>
        <div className="mt-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11.5px] font-medium text-muted">Step {step} of 3</div>
            <ModalTitle className="mt-1 text-[19px] leading-tight font-semibold tracking-[-0.015em] text-navy-900">
              {head.title}
            </ModalTitle>
            <ModalDescription className="mt-1 text-[12.5px] leading-relaxed text-muted">{head.sub}</ModalDescription>
          </div>
          <ModalCloseButton label="Close" />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-6 pt-5 pb-2">
        {step === 1 && (
          <div className="space-y-4">
            <Field
              label="Date"
              hint="Petsa"
              error={tried && missing.date ? 'Choose the meeting date.' : datePast ? 'Select today or a later date.' : null}
            >
              <input
                type="date"
                value={draft.date}
                min={TODAY}
                onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
                className={inputClass(Boolean((tried && missing.date) || datePast))}
              />
              {draft.date && !datePast && (
                <span className="mt-1.5 block text-[11.5px] text-muted">Prints as “{meetingDateText(draft.date)}”</span>
              )}
            </Field>
            <Field label="Time" hint="Oras" error={tried && missing.time ? 'Enter the time.' : null}>
              <input
                value={draft.time}
                onChange={(e) => setDraft((d) => ({ ...d, time: e.target.value }))}
                placeholder="9:00 – 11:00 ng umaga"
                className={inputClass(tried && missing.time)}
              />
            </Field>
            <Field label="Venue" hint="Lugar" error={tried && missing.venue ? 'Enter the venue.' : null}>
              <input
                value={draft.venue}
                onChange={(e) => setDraft((d) => ({ ...d, venue: e.target.value }))}
                placeholder="Silid-aklatan, Detailen Elem. School"
                className={inputClass(tried && missing.venue)}
              />
            </Field>
            {meeting && meeting.date < TODAY && (
              <Callout tone="info">The last meeting, {formatDate(meeting.date)}, has passed.</Callout>
            )}
            {error && <Callout tone="error">{error}</Callout>}
          </div>
        )}

        {step === 2 && (
          <div>
            <div className="flex items-center gap-2">
              <div className="flex shrink-0 gap-1">
                {(
                  [
                    ['new', `Not invited · ${newCount}`],
                    ['all', `All flagged · ${flagged.length}`],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setScope(k)}
                    aria-pressed={scope === k}
                    className={cx(
                      PILL,
                      'tnum h-8 px-3.5 text-[11.5px]',
                      scope === k ? PILL_ON : PILL_OFF,
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="relative min-w-0 flex-1">
                <MagnifyingGlass size={13} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-placeholder" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search"
                  aria-label="Search flagged learners"
                  className="h-8 w-full rounded-full bg-wash pr-7 pl-8 text-[12px] text-ink placeholder:text-placeholder focus:bg-white focus:shadow-[inset_0_0_0_1px_var(--color-navy-600)] focus:outline-none"
                />
                {q && (
                  <button
                    type="button"
                    onClick={() => setQ('')}
                    aria-label="Clear search"
                    className="absolute top-1/2 right-2 grid size-5 -translate-y-1/2 place-items-center rounded-full text-placeholder hover:text-navy-900"
                  >
                    <X size={11} weight="bold" />
                  </button>
                )}
              </label>
            </div>

            <div className="mt-3 overflow-hidden rounded-[14px] shadow-[inset_0_0_0_1px_var(--color-line)]">
              {rows.length > 0 && (
                <button
                  type="button"
                  onClick={toggleAll}
                  className="flex w-full items-center gap-3 border-b border-line px-4 py-2.5 text-left text-[12px] font-medium text-navy-800 hover:bg-wash"
                >
                  <Tick on={allInView} partial={!allInView && inView > 0} />
                  {allInView ? 'Clear all' : 'Select all'}
                  <span className="tnum ml-auto text-[11.5px] font-normal text-muted">{n} selected</span>
                </button>
              )}
              <ul className="max-h-[340px] overflow-auto">
                {rows.map((l) => {
                  const on = picked.has(l.id)
                  return (
                    <li key={l.id} className="border-b border-line-soft last:border-b-0">
                      <button
                        type="button"
                        onClick={() => toggle(l.id)}
                        aria-pressed={on}
                        className={cx(
                          'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-100',
                          on ? 'bg-navy-50/50' : 'hover:bg-wash',
                        )}
                      >
                        <Tick on={on} />
                        <Initials l={l} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-medium text-navy-900">{fullName(l)}</span>
                          <span className="block truncate text-[11px] text-muted">
                            {l.section} · {[l.bmiBand, l.hfaBand].filter((b) => b && b !== 'Normal').join(', ')}
                          </span>
                        </span>
                        {l.slip !== 'not-printed' && <SlipPill state={l.slip} />}
                      </button>
                    </li>
                  )
                })}
                {rows.length === 0 && (
                  <li className="px-4 py-10 text-center text-[12.5px] text-muted">
                    {scope === 'new' && !needle ? 'All flagged learners have been invited.' : 'No flagged learners match.'}
                  </li>
                )}
              </ul>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <div className="grid place-items-center rounded-[16px] bg-ground px-3 py-4">
              {sheet && (
                <div className="slip-scale slip-scale--modal">
                  <SlipSheet learner={sheet} meeting={meeting} />
                </div>
              )}
            </div>
            {n > 1 && (
              <div className="mt-3 flex items-center justify-center gap-2">
                <RoundButton label="Previous slip" onClick={() => flip(-1)}>
                  <CaretLeft size={12} weight="bold" />
                </RoundButton>
                <span className="min-w-0 truncate text-center text-[12px] text-muted">
                  <span className="font-medium text-navy-900">{sheet ? fullName(sheet) : ''}</span>
                  <span className="tnum"> · {Math.min(at, n - 1) + 1} of {n}</span>
                </span>
                <RoundButton label="Next slip" onClick={() => flip(1)}>
                  <CaretRight size={12} weight="bold" />
                </RoundButton>
              </div>
            )}

            {n > 0 && (
              <dl className="mt-4 divide-y divide-line-soft rounded-[14px] text-[12px] shadow-[inset_0_0_0_1px_var(--color-line)]">
                <Summary label="Meeting" onEdit={() => setStep(1)}>
                  {meeting ? `${meetingDateText(meeting.date)} · ${meeting.time} · ${meeting.venue}` : '—'}
                </Summary>
                <Summary label="Learners" onEdit={() => setStep(2)}>
                  {selected
                    .slice(0, 3)
                    .map((l) => `${l.lastName}, ${l.firstName[0]}.`)
                    .join(' · ')}
                  {n > 3 ? ` +${n - 3} more` : ''}
                </Summary>
              </dl>
            )}
          </div>
        )}
      </div>

      <footer className="flex shrink-0 items-center gap-2 px-6 pt-3 pb-5">
        {step > 1 ? (
          <button
            type="button"
            onClick={() => setStep((step - 1) as Step)}
            disabled={busy}
            className="flex h-10 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium text-muted transition-colors duration-100 hover:bg-wash hover:text-navy-900 disabled:opacity-50"
          >
            <ArrowLeft size={13} weight="bold" />
            Back
          </button>
        ) : (
          <span />
        )}
        <span className="flex-1" />
        {step === 1 && (
          <PrimaryButton onClick={next}>
            Continue
            <ArrowRight size={14} weight="bold" />
          </PrimaryButton>
        )}
        {step === 2 && (
          <PrimaryButton onClick={next} disabled={n === 0}>
            Continue with {n}
            <ArrowRight size={14} weight="bold" />
          </PrimaryButton>
        )}
        {step === 3 && (
          <>
            <button
              type="button"
              onClick={() => onIssue('pdf', selected)}
              disabled={!canIssue}
              className="flex h-10 items-center gap-2 rounded-full px-4 text-[12.5px] font-medium text-navy-800 shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors duration-100 hover:bg-wash disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FilePdf size={15} />
              Save PDF
            </button>
            <PrimaryButton onClick={() => onIssue('paper', selected)} disabled={!canIssue}>
              <Printer size={15} weight="bold" />
              {busy ? 'Printing…' : `Print ${n} slip${n === 1 ? '' : 's'}`}
            </PrimaryButton>
          </>
        )}
      </footer>
    </>
  )
}

/* --- Pieces ---------------------------------------------------------------- */

export function inputClass(invalid: boolean) {
  return cx(
    'h-11 w-full rounded-[12px] bg-white px-3.5 text-[13.5px] text-navy-900 placeholder:text-placeholder',
    'transition-[box-shadow] duration-100 focus:outline-none',
    invalid
      ? 'shadow-[inset_0_0_0_1px_#be123c] focus:shadow-[inset_0_0_0_1px_#be123c,0_0_0_3px_rgba(190,18,60,0.14)]'
      : 'shadow-[inset_0_0_0_1px_var(--color-line)] focus:shadow-[inset_0_0_0_1.5px_var(--color-navy-600),0_0_0_4px_rgba(43,82,196,0.12)]',
  )
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint: string
  error: string | null
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline gap-1.5 text-[12.5px] font-medium text-navy-900">
        {label}
        <span className="text-[11px] font-normal text-muted italic">{hint}</span>
      </span>
      {children}
      {error && (
        <span role="alert" className="mt-1.5 flex items-center gap-1 text-[11.5px] text-[#be123c]">
          <Warning size={12} weight="fill" />
          {error}
        </span>
      )}
    </label>
  )
}

/* --- Changing a meeting that slips already name ---------------------------
   A slip freezes the meeting at print time, so a parent holding one goes on
   the date it shows. Moving the meeting after slips are out therefore asks
   first and says how many parents are affected (2026-10-13). */

/** Parents invited and not yet seen: the ones holding a slip with the old date. */
export const waitingParents = (learners: Learner[]) => learners.filter((l) => l.slip === 'printed').length

export function MeetingChangeConfirm({
  open,
  onOpenChange,
  waiting,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  waiting: number
  onConfirm: () => void
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Change the parent meeting?"
      body={`${waiting} parent${waiting === 1 ? ' has' : 's have'} a slip with the current date, time and venue. Reprint their slips so they receive the new details.`}
      confirmLabel="Change meeting"
      onConfirm={onConfirm}
    />
  )
}

export function Callout({ tone, children }: { tone: 'info' | 'error'; children: ReactNode }) {
  return (
    <p
      className={cx(
        'flex items-start gap-2 rounded-[12px] px-3 py-2.5 text-[12px] leading-relaxed',
        tone === 'info' ? 'bg-gold-100 text-gold-700' : 'bg-[#fdf2f5] text-[#9f1239]',
      )}
    >
      {tone === 'info' ? <Info size={14} weight="fill" className="mt-0.5 shrink-0" /> : <Warning size={14} weight="fill" className="mt-0.5 shrink-0" />}
      <span>{children}</span>
    </p>
  )
}

export function Tick({ on, partial }: { on: boolean; partial?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        'grid size-[18px] shrink-0 place-items-center rounded-[6px] transition-colors duration-100',
        on || partial ? 'bg-navy-600 text-white' : 'bg-white shadow-[inset_0_0_0_1.5px_#b6c0d3]',
      )}
    >
      {on ? <Check size={11} weight="bold" /> : partial ? <span className="h-[2px] w-2 rounded-full bg-white" /> : null}
    </span>
  )
}

function Summary({ label, onEdit, children }: { label: string; onEdit: () => void; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <dt className="w-16 shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 text-navy-900">{children}</dd>
      <button type="button" onClick={onEdit} className="shrink-0 text-[11.5px] font-medium text-navy-600 hover:text-navy-900">
        Edit
      </button>
    </div>
  )
}

function RoundButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid size-8 shrink-0 place-items-center rounded-full text-navy-800 shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors duration-100 hover:bg-wash"
    >
      {children}
    </button>
  )
}

export function Initials({ l }: { l: Learner }) {
  return (
    <span
      className={cx(
        'grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold',
        l.sex === 'F' ? 'bg-[#fbe3ee] text-[#9d174d]' : 'bg-[#e0f2fe] text-[#075985]',
      )}
    >
      {l.firstName[0]}
      {l.lastName[0]}
    </span>
  )
}

/* The slip state as a pill: gold while the letter is out, green once the
   parent came, grey before anything was printed. */
export function SlipPill({ state }: { state: Learner['slip'] }) {
  const it = {
    'not-printed': { label: 'Not invited', className: 'bg-wash text-muted' },
    printed: { label: 'Invited', className: 'bg-gold-100 text-gold-700' },
    attended: { label: 'Attended', className: 'bg-[#e6f4ec] text-[var(--color-n)]' },
  }[state]
  return (
    <span className={cx('inline-block shrink-0 rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold whitespace-nowrap', it.className)}>
      {it.label}
    </span>
  )
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-10 shrink-0 items-center gap-2 rounded-full px-5 text-[12.5px] font-semibold text-[#071539] transition-[filter] duration-100 hover:brightness-95 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
      style={{ background: Y }}
    >
      {children}
    </button>
  )
}
