import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import { CaretLeft, CaretRight, Check, PencilSimple, Warning } from '@phosphor-icons/react'
import { Modal, ModalCloseButton, ModalContent, ModalDescription, ModalTitle, Select } from '@/components/primitives'
import { PILL, PILL_OFF, PILL_ON, cx } from '@/components/ui'
import { Y } from '@/components/bento'
import SlipSheet from '@/components/SlipSheet'
import { Callout, Field, MeetingChangeConfirm, inputClass, waitingParents, type IssueMode } from '@/components/SlipWizard'
import { TODAY, fullName, type Learner } from '@/data/mock'
import { SERVER_BACKED, useRoster, type Meeting } from '@/lib/records'
import { endpoints, ApiError } from '@/lib/api'
import { setSchoolInfo, useSlipText } from '@/lib/school-year'
import { DEFAULT_SLIP_TEXT, SLIP_TEXT_MAX, isDefaultSlipText, slipTextOf, type SlipText } from '@/lib/slip-text'
import { formatDate } from '@/lib/dates'
import { pdfFileName, printPaper, savePdf } from '@/lib/print'
import { toast } from '@/components/toast'

/* Invitation slips, as one page: the slip on the left, the list on the right
   (swapped 2026-10-13, the user's request) - built from the user's mockup
   (2026-10-12), replacing the meeting
   timeline and its three-step print wizard.

   The list has three tabs by slip state. Learners still to invite start
   ticked, because sending them a slip is what the page is for; the invited
   and the attended start unticked, and ticking one is a reprint. Selecting a
   row shows its slip; the pager walks through the ticked ones, which are
   exactly the sheets "Print" sends. The meeting printed on every slip sits
   in the chip at the top right, with Edit beside it.

   Issuing a batch: the sheets are rendered into `#print-root` - outside the
   app tree, hidden on screen, and the only thing the print stylesheet shows
   - and then either the print dialog or Electron's printToPDF is pointed at
   the page, so both produce the same document. */

type Tab = Learner['slip']

/* The status filter's order: BMI-for-age, worst first, then height-for-age. */
const STATUS_ORDER = ['Severely Wasted', 'Wasted', 'Overweight', 'Obese', 'Severely Stunted', 'Stunted', 'Tall'] as const
type Job = { mode: IssueMode; sheets: Learner[] }

const TABS: { key: Tab; label: string; empty: string }[] = [
  { key: 'not-printed', label: 'To invite', empty: 'All flagged learners have been invited.' },
  { key: 'printed', label: 'Invited', empty: 'No slips printed.' },
  { key: 'attended', label: 'Attended', empty: 'No attendance recorded.' },
]

export default function Slips() {
  const { learners, setSlip, meeting } = useRoster()
  const flagged = useMemo(
    () =>
      learners
        .filter((l) => l.measuredOn && (l.bmiBand !== 'Normal' || l.hfaBand !== 'Normal'))
        .sort((a, b) => fullName(a).localeCompare(fullName(b))),
    [learners],
  )
  const nextMeeting = meeting && meeting.date >= TODAY ? meeting : null

  /* --- Selection ----------------------------------------------------------
     Kept as the ids ticked AWAY from their tab's default, so a learner who
     is printed moves to Invited unticked without anything having to clear
     them, and a learner newly flagged arrives in To invite already ticked. */
  const [tab, setTab] = useState<Tab>('not-printed')
  const [flipped, setFlipped] = useState<Set<string>>(() => new Set())
  const isPicked = (l: Learner) => (l.slip === 'not-printed') !== flipped.has(l.id)
  const toggle = (id: string) =>
    setFlipped((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /* --- Grade and status filters (2026-10-14, the user's request) -----------
     Both narrow the list, the tab counts AND the batch: with "Grade 4" and
     "Obese" chosen, Print sends only those ticked slips, so one class or one
     group can be done at a time. Only grades and statuses that a flagged
     learner actually has are offered. A status matches either index - BMI
     (Wasted, Obese...) or height (Stunted, Tall). */
  const [grade, setGrade] = useState('all')
  const [status, setStatus] = useState('all')
  const grades = useMemo(() => {
    const seen = new Map<string, number>()
    for (const l of flagged) if (!seen.has(l.section)) seen.set(l.section, l.gradeLevel)
    return [...seen].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([name]) => name)
  }, [flagged])
  const statuses = useMemo(
    () => STATUS_ORDER.filter((b) => flagged.some((l) => l.bmiBand === b || l.hfaBand === b)),
    [flagged],
  )
  const shown = flagged.filter(
    (l) =>
      (grade === 'all' || l.section === grade) &&
      (status === 'all' || l.bmiBand === status || l.hfaBand === status),
  )
  const narrowed = grade !== 'all' || status !== 'all'

  const counts = { 'not-printed': 0, printed: 0, attended: 0 }
  for (const l of shown) counts[l.slip]++
  const rows = shown.filter((l) => l.slip === tab)

  /* The sheets that print, in tab order, so the pager reads like the list. */
  const picked = TABS.flatMap((t) => shown.filter((l) => l.slip === t.key && isPicked(l)))
  const n = picked.length

  /* The slip on screen. A row can be looked at without being ticked. */
  const [focusId, setFocusId] = useState<string | null>(null)
  const focus =
    learners.find((l) => l.id === focusId) ?? picked[0] ?? rows[0] ?? shown[0] ?? null
  const at = focus ? picked.findIndex((l) => l.id === focus.id) : -1
  const flip = (by: 1 | -1) => {
    if (n === 0) return
    const i = at < 0 ? (by === 1 ? 0 : n - 1) : (at + by + n) % n
    setFocusId(picked[i]!.id)
  }
  const normal = focus && !flagged.some((l) => l.id === focus.id)

  /* ?learner=<id> from a learner's record or the weigh-in opens the page on
     that learner, ticked alone. Consumed once: it is an instruction, not a
     view. */
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    const want = params.get('learner')
    if (!want) return
    const l = learners.find((x) => x.id === want)
    if (l) {
      const only = new Set(flagged.filter((x) => x.slip === 'not-printed' && x.id !== want).map((x) => x.id))
      if (l.slip !== 'not-printed' && flagged.some((x) => x.id === want)) only.add(want)
      setFlipped(only)
      setGrade('all')
      setStatus('all')
      setTab(l.slip)
      setFocusId(want)
    }
    const next = new URLSearchParams(params)
    next.delete('learner')
    setParams(next, { replace: true })
  }, [params, setParams, learners, flagged])

  /* --- Meeting ------------------------------------------------------------ */
  const [editing, setEditing] = useState(false)
  const [wording, setWording] = useState(false)

  /* --- Printing ------------------------------------------------------------ */
  const [job, setJob] = useState<Job | null>(null)
  const busy = job !== null

  function issue(mode: IssueMode) {
    if (busy || n === 0) return
    if (!nextMeeting) {
      setEditing(true)
      return
    }
    setJob({ mode, sheets: picked })
  }

  /* One turn after the sheets are committed to #print-root. A timer, not
     requestAnimationFrame: rAF does not fire while the window is hidden, and
     a print that silently never happens is the worst outcome here. */
  useEffect(() => {
    if (!job) return
    let cancelled = false
    const id = window.setTimeout(() => {
      if (!cancelled) void run(job)
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job])

  /* The print dialog reports nothing back, so the stamp says the slips were
     issued, not that paper came out - stamped anyway, because the meeting
     has to know who to expect. A parent who already attended keeps
     "Attended": a reprint for them is a spare copy and must not undo it.
     Every printed sheet then falls back to its tab's default, which for a
     learner now in Invited or Attended is unticked. */
  function stamp(sheets: Learner[]) {
    for (const l of sheets) if (l.slip !== 'attended') setSlip(l.id, 'printed', TODAY, meeting)
    setFlipped((prev) => {
      const next = new Set(prev)
      for (const l of sheets) next.delete(l.id)
      return next
    })
  }

  async function run(j: Job) {
    const count = j.sheets.length
    const plural = count === 1 ? '' : 's'
    try {
      if (j.mode === 'paper') {
        const res = await printPaper(`Advisory slip${plural}`)
        if (res.ok) {
          stamp(j.sheets)
          toast.success(`Sent ${count} slip${plural} to the printer.`)
        } else if (res.reason === 'error') {
          toast.error('The slips could not be printed. Try again.')
        }
        return
      }
      const res = await savePdf(pdfFileName(count, j.sheets[0]?.stubId ?? null, TODAY))
      if (res.ok) {
        stamp(j.sheets)
        toast.success(`Saved ${count} slip${plural} as a PDF.`)
      } else if (res.reason === 'unavailable') {
        /* A plain browser in development: the print dialog's own "Save as
           PDF" destination is the fallback, and it is honest to say so. */
        void printPaper()
        stamp(j.sheets)
        toast.info('Choose “Save as PDF” in the print window to save the file.')
      } else if (res.reason !== 'canceled') {
        toast.error('The PDF could not be saved. Try again.')
      }
    } finally {
      setJob(null)
    }
  }

  return (
    <div className="h-full overflow-auto px-6 pt-1 pb-6">
      <div className="grid min-h-full grid-cols-1 gap-6 lg:h-full lg:grid-cols-[minmax(0,1fr)_304px]">
        {/* --- The slip ------------------------------------------------------ */}
        <section className="flex min-w-0 flex-col items-center lg:min-h-0">
          <div className="flex w-full items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3 rounded-[12px] bg-white py-1.5 pr-1.5 pl-4 shadow-[0_1px_2px_rgba(14,36,100,0.06)]">
              <span className="truncate text-[12.5px] font-semibold text-navy-900">
                {nextMeeting
                  ? `${chipDay(nextMeeting.date)} · ${nextMeeting.time} · ${nextMeeting.venue}`
                  : 'No parent meeting set'}
              </span>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-[8px] bg-navy-50 px-3 py-1.5 text-[12px] font-semibold text-navy-700 transition-colors duration-100 hover:bg-navy-100"
              >
                {nextMeeting ? 'Edit' : 'Set'}
              </button>
            </div>
            {/* The slip's own wording (2026-10-19). The server build only:
                it is stored with the school. */}
            {SERVER_BACKED && (
              <button
                type="button"
                onClick={() => setWording(true)}
                className="flex h-[42px] shrink-0 items-center gap-2 rounded-[12px] bg-white px-4 text-[12.5px] font-semibold text-navy-900 shadow-[0_1px_2px_rgba(14,36,100,0.06)] transition-colors duration-100 hover:bg-wash"
              >
                <PencilSimple size={14} weight="bold" />
                Edit wording
              </button>
            )}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <PagerButton label="Previous slip" onClick={() => flip(-1)} disabled={n === 0}>
              <CaretLeft size={12} weight="bold" />
            </PagerButton>
            <span className="tnum min-w-[92px] text-center text-[12.5px] text-muted">
              {at >= 0 ? (
                <>
                  Slip <span className="mx-1 font-semibold text-navy-900">{at + 1}</span> of {n}
                </>
              ) : n > 0 ? (
                'Not selected'
              ) : (
                'No slips selected'
              )}
            </span>
            <PagerButton label="Next slip" onClick={() => flip(1)} disabled={n === 0}>
              <CaretRight size={12} weight="bold" />
            </PagerButton>
          </div>

          <div className="mt-3 w-full max-w-[720px]">
            {focus ? (
              <FitSlip learner={focus} meeting={nextMeeting} />
            ) : (
              <div className="panel grid aspect-[8.5/5.5] place-items-center text-[12.5px] text-muted">
                No flagged learners.
              </div>
            )}

            {normal && (
              <p className="mt-3 text-center text-[12px] text-muted">
                {fullName(focus)} has a normal nutritional status. No invitation is required.
              </p>
            )}

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => issue('paper')}
                disabled={n === 0 || busy}
                className="h-12 rounded-[14px] text-[13.5px] font-semibold text-[#071539] transition-[filter] duration-100 hover:brightness-95 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: Y }}
              >
                {busy && job?.mode === 'paper' ? 'Printing…' : `Print ${n} slip${n === 1 ? '' : 's'}`}
              </button>
              <button
                type="button"
                onClick={() => issue('pdf')}
                disabled={n === 0 || busy}
                className="h-12 rounded-[14px] bg-white text-[13.5px] font-semibold text-navy-900 shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors duration-100 hover:bg-wash disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy && job?.mode === 'pdf' ? 'Saving…' : 'Save as PDF'}
              </button>
            </div>
            <p className="mt-3 text-center text-[11.5px] text-muted">
              {nextMeeting ? 'No printer? Save as PDF and print the file later.' : 'Set the parent meeting before printing.'}
            </p>
          </div>
        </section>

        {/* --- The list ------------------------------------------------------ */}
        <section className="panel flex min-h-[420px] flex-col overflow-hidden p-3 lg:min-h-0">
          <div role="tablist" aria-label="Slip status" className="grid shrink-0 grid-cols-3 gap-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cx(PILL, 'h-9 px-2 text-[12px]', tab === t.key ? PILL_ON : PILL_OFF)}
              >
                {t.label}
                <span className="tnum opacity-70">{counts[t.key]}</span>
              </button>
            ))}
          </div>

          <div className="mt-2 grid shrink-0 grid-cols-2 gap-1.5">
            <Select
              label="Filter by grade"
              value={grade}
              onValueChange={(v) => {
                setGrade(v)
                setFocusId(null)
              }}
              options={[{ value: 'all', label: 'All grades' }, ...grades.map((g) => ({ value: g, label: g }))]}
              className="h-9 w-full min-w-0 justify-between rounded-[10px] px-3 text-[12px]"
            />
            <Select
              label="Filter by nutritional status"
              value={status}
              onValueChange={(v) => {
                setStatus(v)
                setFocusId(null)
              }}
              options={[{ value: 'all', label: 'All statuses' }, ...statuses.map((b) => ({ value: b, label: b }))]}
              className="h-9 w-full min-w-0 justify-between rounded-[10px] px-3 text-[12px]"
            />
          </div>

          <ul className="mt-3 min-h-0 flex-1 space-y-0.5 overflow-auto">
            {rows.map((l) => {
              const on = isPicked(l)
              const current = focus?.id === l.id
              return (
                <li
                  key={l.id}
                  className={cx(
                    'flex items-center gap-2 rounded-[10px] pr-3 transition-colors duration-100',
                    current ? 'bg-navy-50' : 'hover:bg-wash',
                  )}
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    aria-label={`Print a slip for ${fullName(l)}`}
                    onClick={() => toggle(l.id)}
                    className="grid size-9 shrink-0 place-items-center"
                  >
                    <span
                      aria-hidden
                      className={cx(
                        'grid size-[18px] place-items-center rounded-[5px] transition-colors duration-100',
                        on ? 'bg-navy-600 text-white' : 'bg-white shadow-[inset_0_0_0_1.5px_#b6c0d3]',
                      )}
                    >
                      {on && <Check size={11} weight="bold" />}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFocusId(l.id)}
                    aria-current={current || undefined}
                    className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left"
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-navy-900">{fullName(l)}</span>
                    <span className="shrink-0 text-[11px] text-muted">{l.section}</span>
                  </button>
                </li>
              )
            })}
            {rows.length === 0 && (
              <li className="px-3 py-10 text-center text-[12.5px] text-muted">
                {narrowed && flagged.some((l) => l.slip === tab)
                  ? 'No learners match the filters.'
                  : TABS.find((t) => t.key === tab)!.empty}
              </li>
            )}
          </ul>
        </section>
      </div>

      <MeetingDialog open={editing} onOpenChange={setEditing} learner={focus ?? flagged[0] ?? null} />
      <WordingDialog
        open={wording}
        onOpenChange={setWording}
        learner={focus ?? flagged[0] ?? learners[0] ?? null}
        meeting={nextMeeting}
      />

      {/* Off-tree, hidden on screen, and the only thing that reaches paper. */}
      {job ? <PrintJob sheets={job.sheets} meeting={meeting} /> : null}
    </div>
  )
}

/* --- Pieces ------------------------------------------------------------------ */

/* The slip at the width of its column. The sheet is laid out in inches for
   the printer, so it is scaled as a whole rather than reflowed. */
function FitSlip({
  learner,
  meeting,
  text,
  onOverflow,
}: {
  learner: Learner
  meeting: Meeting | null
  text?: SlipText
  onOverflow?: (over: boolean) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(0.7)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const fit = () => setZoom(Math.min(el.clientWidth / 816, 1))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={box} className="w-full overflow-hidden rounded-[6px] shadow-[0_12px_32px_rgba(14,36,100,0.10)]" style={{ height: 528 * zoom }}>
      <div style={{ width: 816, transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
        <SlipSheet learner={learner} meeting={meeting} text={text} onOverflow={onOverflow} />
      </div>
    </div>
  )
}

function PagerButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid size-8 place-items-center rounded-[10px] bg-white text-navy-800 shadow-[0_1px_2px_rgba(14,36,100,0.06)] transition-colors duration-100 hover:bg-wash disabled:opacity-40"
    >
      {children}
    </button>
  )
}

/* The meeting printed on every slip. A past meeting keeps its time and
   venue, which rarely change from one meeting to the next, but not its date. */
/* The parent meeting, with the slip beside it (2026-10-14, the user asked
   for a real-time dialog). The form is on the left and the selected
   learner's slip on the right, redrawn on every keystroke, so the head sees
   exactly what will be printed before saving. Under the date: how it prints
   and how far away it is. Under time and venue: common choices as chips,
   one tap to fill, still free to type anything. */
function MeetingDialog({
  open,
  onOpenChange,
  learner,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  learner: Learner | null
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      {open && (
        <ModalContent className="max-w-[920px]">
          <MeetingForm learner={learner} onDone={() => onOpenChange(false)} />
        </ModalContent>
      )}
    </Modal>
  )
}

/* Time is picked, not typed (2026-10-14, the user's request): the
   browser's own time picker, as the date already uses its calendar. The
   meeting still stores and prints the time as text - "2:00 PM", or
   "2:00 PM – 4:00 PM" when an end time is given - so slips printed before
   this change read the same. */

/** "14:00" -> "2:00 PM". */
function to12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** "2:00 PM" -> "14:00"; anything else -> "" (an older free-text time is
    picked again rather than guessed at). */
function from12(text: string): string {
  const m = text.trim().match(/^(\d{1,2}):(\d{2})\s*([AP])\.?M\.?$/i)
  if (!m) return ''
  const h = (Number(m[1]) % 12) + (m[3].toUpperCase() === 'P' ? 12 : 0)
  return `${String(h).padStart(2, '0')}:${m[2]}`
}

/** A stored meeting time split back into the two pickers. */
function splitTime(text: string): { start: string; end: string } {
  const [a = '', b = ''] = text.split(/\s*[–-]\s*/)
  return { start: from12(a), end: from12(b) }
}

/** Opens the browser's picker on any click in the box, not only on its icon. */
function openPicker(e: MouseEvent<HTMLInputElement>) {
  try {
    e.currentTarget.showPicker?.()
  } catch {
    /* already open, or not supported: the icon still works */
  }
}

const VENUE_CHOICES = ['School library', 'Covered court', 'School clinic', 'Classroom']

/** "Today", "Tomorrow", "In 6 days" - from TODAY, both plain dates. */
function fromToday(iso: string): string {
  const days = Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${TODAY}T00:00:00Z`)) / 86_400_000)
  if (Number.isNaN(days)) return ''
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return `In ${days} days`
}

function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00`)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function Choices({ items, value, onPick }: { items: string[]; value: string; onPick: (v: string) => void }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {items.map((v) => {
        const on = value.trim().toLowerCase() === v.toLowerCase()
        return (
          <button
            key={v}
            type="button"
            onClick={() => onPick(v)}
            aria-pressed={on}
            className={cx(
              'h-7 rounded-full px-3 text-[11.5px] font-medium transition-colors duration-100',
              on ? 'bg-navy-800 text-white' : 'bg-wash text-navy-900 hover:bg-navy-50',
            )}
          >
            {v}
          </button>
        )
      })}
    </div>
  )
}

function MeetingForm({ learner, onDone }: { learner: Learner | null; onDone: () => void }) {
  const { learners, meeting, setMeeting, error, clearError } = useRoster()
  const [confirmMove, setConfirmMove] = useState(false)
  const [draft, setDraft] = useState<Meeting>(() =>
    meeting ? { ...meeting, date: meeting.date >= TODAY ? meeting.date : '' } : { date: '', time: '', venue: '' },
  )
  const [tried, setTried] = useState(false)
  /* The two pickers, as "HH:MM". The text that prints is built from them. */
  const [start, setStart] = useState(() => splitTime(draft.time).start)
  const [end, setEnd] = useState(() => splitTime(draft.time).end)
  const time = start ? (end ? `${to12(start)} – ${to12(end)}` : to12(start)) : ''
  const endBeforeStart = Boolean(start && end && end <= start)

  const datePast = draft.date !== '' && draft.date < TODAY
  const missing = { date: !draft.date.trim(), time: !start, venue: !draft.venue.trim() }
  const ok = !missing.date && !missing.time && !missing.venue && !datePast && !endBeforeStart
  const changed =
    !meeting || meeting.date !== draft.date || meeting.time !== time || meeting.venue !== draft.venue.trim()
  const set = (k: keyof Meeting) => (v: string) => setDraft((d) => ({ ...d, [k]: v }))

  function apply() {
    clearError()
    setMeeting({ date: draft.date, time, venue: draft.venue.trim() })
    onDone()
  }

  function save() {
    setTried(true)
    if (!ok) return
    if (changed && meeting && waitingParents(learners) > 0) setConfirmMove(true)
    else apply()
  }

  /* The preview never shows a past date: that is an error, said under the
     field, not something to print. */
  const preview: Meeting = { date: datePast ? '' : draft.date, time, venue: draft.venue.trim() }

  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <header className="flex items-start gap-3 px-6 pt-5">
        <div className="min-w-0 flex-1">
          <ModalTitle className="text-[17px] font-semibold tracking-[-0.01em] text-navy-900">Parent meeting</ModalTitle>
          <ModalDescription className="mt-1 text-[12.5px] text-muted">
            The date, time and venue printed on each slip.
          </ModalDescription>
        </div>
        <ModalCloseButton label="Close" />
      </header>

      <div className="grid min-h-0 grid-cols-1 gap-6 overflow-y-auto px-6 pt-5 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        {/* --- The form --- */}
        <div className="space-y-5">
          <Field
            label="Date"
            hint="Petsa"
            error={tried && missing.date ? 'Choose the meeting date.' : datePast ? 'Select today or a later date.' : null}
          >
            <input
              type="date"
              value={draft.date}
              min={TODAY}
              onChange={(e) => set('date')(e.target.value)}
              onClick={openPicker}
              className={inputClass(Boolean((tried && missing.date) || datePast))}
            />
            {draft.date && !datePast && (
              <span className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
                <span className="font-medium text-navy-900">{longDate(draft.date)}</span>
                <span className="rounded-full bg-navy-50 px-2 py-0.5 text-[10.5px] font-semibold text-navy-700">
                  {fromToday(draft.date)}
                </span>
              </span>
            )}
          </Field>

          <div>
            <span className="mb-1.5 flex items-baseline gap-1.5 text-[12.5px] font-medium text-navy-900">
              Time
              <span className="text-[11px] font-normal text-muted italic">Oras</span>
            </span>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[11px] text-muted">Start</span>
                <input
                  type="time"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  onClick={openPicker}
                  className={inputClass(tried && missing.time)}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] text-muted">End (optional)</span>
                <input
                  type="time"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  onClick={openPicker}
                  className={inputClass(endBeforeStart)}
                />
              </label>
            </div>
            {(tried && missing.time) || endBeforeStart ? (
              <span role="alert" className="mt-1.5 flex items-center gap-1 text-[11.5px] text-[#be123c]">
                <Warning size={12} weight="fill" />
                {endBeforeStart ? 'The end time must be after the start time.' : 'Choose the start time.'}
              </span>
            ) : (
              time && <span className="mt-1.5 block text-[11.5px] text-muted">Prints as {time}</span>
            )}
          </div>

          <Field label="Venue" hint="Lugar" error={tried && missing.venue ? 'Enter the venue.' : null}>
            <input
              value={draft.venue}
              onChange={(e) => set('venue')(e.target.value)}
              placeholder="School library"
              className={inputClass(tried && missing.venue)}
            />
            <Choices items={VENUE_CHOICES} value={draft.venue} onPick={set('venue')} />
          </Field>

          {meeting && meeting.date < TODAY && (
            <Callout tone="info">The last meeting, {formatDate(meeting.date)}, has passed.</Callout>
          )}
          {error && <Callout tone="error">{error}</Callout>}
        </div>

        {/* --- The slip, live --- */}
        <div className="min-w-0">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[12.5px] font-medium text-navy-900">Preview</span>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
              <span className="size-1.5 rounded-full bg-[#22a35a]" />
              Updates as you type
            </span>
          </div>
          {learner ? (
            <div className="rounded-[14px] bg-wash p-3">
              <FitSlip learner={learner} meeting={preview} />
            </div>
          ) : (
            <div className="grid aspect-[8.5/5.5] place-items-center rounded-[14px] bg-wash text-[12.5px] text-muted">
              No learner to preview.
            </div>
          )}
          {learner && (
            <p className="mt-2 text-[11.5px] text-muted">
              Showing the slip for {fullName(learner)}. Every slip uses the same meeting details.
            </p>
          )}
        </div>
      </div>

      <MeetingChangeConfirm
        open={confirmMove}
        onOpenChange={setConfirmMove}
        waiting={waitingParents(learners)}
        onConfirm={() => {
          setConfirmMove(false)
          apply()
        }}
      />

      <footer className="flex items-center justify-end gap-2 px-6 pt-5 pb-5">
        {meeting && changed && (
          <span className="mr-auto inline-flex items-center gap-1.5 text-[11.5px] text-gold-700">
            <span className="size-1.5 rounded-full bg-gold-700" />
            Unsaved changes
          </span>
        )}
        <button
          type="button"
          onClick={onDone}
          className="h-10 rounded-full px-4 text-[12.5px] font-medium text-muted transition-colors duration-100 hover:bg-wash hover:text-navy-900"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="h-10 rounded-full px-5 text-[12.5px] font-semibold text-[#071539] transition-[filter] duration-100 hover:brightness-95"
          style={{ background: Y }}
        >
          Save
        </button>
      </footer>
    </form>
  )
}

/* The slip's wording (2026-10-19, the user's request), laid out like the
   meeting dialog: the fields on the left, the slip on the right, redrawn on
   every keystroke. The learner's name, class and Stub ID and the meeting
   stay automatic. "Reset to default" only fills the fields with the
   wording shipped with the app; Save is what changes the slips. */
function WordingDialog({
  open,
  onOpenChange,
  learner,
  meeting,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  learner: Learner | null
  meeting: Meeting | null
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      {open && (
        <ModalContent className="max-w-[1040px]">
          <WordingForm learner={learner} meeting={meeting} onDone={() => onOpenChange(false)} />
        </ModalContent>
      )}
    </Modal>
  )
}

const WORDING_FIELDS: { key: keyof SlipText; label: string; hint: string; rows?: number }[] = [
  { key: 'title', label: 'Title', hint: 'Pamagat' },
  { key: 'subtitle', label: 'Title in English', hint: 'Under the title' },
  { key: 'message', label: 'Message', hint: 'Filipino', rows: 6 },
  { key: 'messageEn', label: 'Message in English', hint: 'Under the message', rows: 4 },
  { key: 'closing', label: 'Closing', hint: 'Above the signature' },
  { key: 'signer', label: 'Signer', hint: 'Under the signature' },
]

function WordingForm({
  learner,
  meeting,
  onDone,
}: {
  learner: Learner | null
  meeting: Meeting | null
  onDone: () => void
}) {
  const saved = useSlipText()
  const [draft, setDraft] = useState<SlipText>(saved)
  const [tried, setTried] = useState(false)
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const blank = WORDING_FIELDS.filter((f) => !draft[f.key].trim()).map((f) => f.key)
  const changed = WORDING_FIELDS.some((f) => draft[f.key] !== saved[f.key])
  const atDefault = isDefaultSlipText(draft)

  async function save() {
    setTried(true)
    if (blank.length > 0 || over) return
    if (!changed) return onDone()
    setBusy(true)
    setError(null)
    try {
      /* The defaults are stored as "none", so a later change to the wording
         shipped with the app reaches a school that never edited it. */
      const res = isDefaultSlipText(draft)
        ? await endpoints.resetSlipText()
        : await endpoints.saveSlipText(
            Object.fromEntries(WORDING_FIELDS.map((f) => [f.key, draft[f.key].trim()])) as unknown as SlipText,
          )
      setSchoolInfo({ slipText: slipTextOf(res.slipText) })
      toast.success('Slip wording saved.')
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The wording could not be saved. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <header className="flex items-start gap-3 px-6 pt-5">
        <div className="min-w-0 flex-1">
          <ModalTitle className="text-[17px] font-semibold tracking-[-0.01em] text-navy-900">Slip wording</ModalTitle>
          <ModalDescription className="mt-1 text-[12.5px] text-muted">
            The text printed on every slip. The learner&rsquo;s name, class, Stub ID and the meeting details are
            filled in automatically.
          </ModalDescription>
        </div>
        <ModalCloseButton label="Close" />
      </header>

      <div className="grid min-h-0 grid-cols-1 gap-6 overflow-y-auto px-6 pt-5 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        {/* --- The form --- */}
        <div className="space-y-4">
          {WORDING_FIELDS.map((f) => {
            const value = draft[f.key]
            const invalid = tried && blank.includes(f.key)
            const set = (v: string) => setDraft((d) => ({ ...d, [f.key]: v }))
            return (
              <Field key={f.key} label={f.label} hint={f.hint} error={invalid ? `Enter the ${f.label.toLowerCase()}.` : null}>
                {f.rows ? (
                  <textarea
                    value={value}
                    rows={f.rows}
                    maxLength={SLIP_TEXT_MAX[f.key]}
                    onChange={(e) => set(e.target.value)}
                    className={cx(inputClass(invalid), 'h-auto resize-none py-2.5 leading-relaxed')}
                  />
                ) : (
                  <input
                    value={value}
                    maxLength={SLIP_TEXT_MAX[f.key]}
                    onChange={(e) => set(e.target.value)}
                    className={inputClass(invalid)}
                  />
                )}
                {f.key === 'message' && (
                  <span className="mt-1.5 block text-[11.5px] text-muted">Text between ** and ** prints in bold.</span>
                )}
              </Field>
            )
          })}
          {error && <Callout tone="error">{error}</Callout>}
        </div>

        {/* --- The slip, live --- */}
        <div className="min-w-0">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[12.5px] font-medium text-navy-900">Preview</span>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
              <span className="size-1.5 rounded-full bg-[#22a35a]" />
              Updates as you type
            </span>
          </div>
          {learner ? (
            <div className="rounded-[14px] bg-wash p-3">
              <FitSlip learner={learner} meeting={meeting} text={draft} onOverflow={setOver} />
            </div>
          ) : (
            <div className="grid aspect-[8.5/5.5] place-items-center rounded-[14px] bg-wash text-[12.5px] text-muted">
              No learner to preview.
            </div>
          )}
          {learner && (
            <p className="mt-2 text-[11.5px] text-muted">
              Showing the slip for {fullName(learner)}. Every slip uses the same wording.
            </p>
          )}
          {over && (
            <div className="mt-3">
              <Callout tone="error">The text does not fit on the slip. Shorten the message.</Callout>
            </div>
          )}
        </div>
      </div>

      <footer className="flex items-center justify-end gap-2 px-6 pt-5 pb-5">
        <button
          type="button"
          onClick={() => {
            setDraft(DEFAULT_SLIP_TEXT)
            setTried(false)
          }}
          disabled={atDefault}
          className="mr-auto h-10 rounded-full px-4 text-[12.5px] font-medium text-navy-700 transition-colors duration-100 hover:bg-wash disabled:cursor-not-allowed disabled:opacity-40"
        >
          Reset to default
        </button>
        {changed && (
          <span className="inline-flex items-center gap-1.5 text-[11.5px] text-gold-700">
            <span className="size-1.5 rounded-full bg-gold-700" />
            Unsaved changes
          </span>
        )}
        <button
          type="button"
          onClick={onDone}
          className="h-10 rounded-full px-4 text-[12.5px] font-medium text-muted transition-colors duration-100 hover:bg-wash hover:text-navy-900"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy}
          className="h-10 rounded-full px-5 text-[12.5px] font-semibold text-[#071539] transition-[filter] duration-100 hover:brightness-95 disabled:opacity-50"
          style={{ background: Y }}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </footer>
    </form>
  )
}

function chipDay(iso: string): string {
  const d = new Date(`${iso}T00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function PrintJob({ sheets, meeting }: { sheets: Learner[]; meeting: Meeting | null }) {
  const host = document.getElementById('print-root')
  if (!host) return null
  return createPortal(
    <>
      {sheets.map((l) => (
        <SlipSheet key={l.id} learner={l} meeting={meeting} />
      ))}
    </>,
    host,
  )
}
