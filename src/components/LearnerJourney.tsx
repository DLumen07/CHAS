import { useMemo } from 'react'
import { cx } from './ui'
import { Y } from './bento'
import { IMMUNIZATION_LABEL, type Learner } from '../data/mock'
import { BAND_COLOR, classifyBmiForAge } from '../lib/nutrition'
import { growthRows, type GrowthRow } from '../lib/growth'
import { schoolYearStart } from '../lib/school-year'
import { todayIso } from '../lib/dates'
import type { ApiLearnerRecord } from '../lib/api'

/* The top of the learner profile: the school year as one line (2026-10-19,
   option C "School-year journey" of three drafts).

   June to May, left to right. Every weigh-in this school year sits on it,
   with the invitation slip and the parent's attendance, a marker for today,
   and the endline still to come. Below it four figures: height, weight,
   immunization and the next step for this learner. The full record - every
   measurement, the health history, the immunization card - follows under
   it in the dialog, unchanged. */

const MONTHS = ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May']

type Kind = 'baseline' | 'endline' | 'followup' | 'slip' | 'attended' | 'due'

interface Mark {
  key: string
  kind: Kind
  /** 0..1 along the year. */
  at: number
  label: string
  detail: string
}

const DOT: Record<Kind, string> = {
  baseline: 'size-[16px] bg-navy-900 ring-[3px] ring-white',
  endline: 'size-[16px] bg-navy-900 ring-[3px] ring-white',
  followup: 'size-[13px] bg-navy-700 ring-[3px] ring-white',
  slip: 'size-[12px] border-2 border-navy-900 ring-[3px] ring-white',
  attended: 'size-[12px] bg-[var(--color-n)] ring-[3px] ring-white',
  due: 'size-[16px] border-2 border-dashed border-navy-900 bg-white',
}

/** A date or an instant as yyyy-mm-dd on this computer's calendar. */
function isoDay(s: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s.slice(0, 10)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function shortDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Where a day falls between 1 June and 31 May, 0..1. */
function positionOf(iso: string, start: number): number {
  const from = Date.UTC(start, 5, 1)
  const to = Date.UTC(start + 1, 5, 1)
  const [y, m, d] = iso.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d)
  return Math.min(1, Math.max(0, (t - from) / (to - from)))
}

/** The year's weigh-ins: the first in June to December is the baseline, the
    first in January to May the endline, any other a follow-up. */
function weighIns(rows: GrowthRow[], start: number) {
  const inYear = rows.filter((r) => r.date >= `${start}-06-01` && r.date <= `${start + 1}-05-31`)
  let baseline = false
  let endline = false
  return inYear.map((r) => {
    const first = r.date < `${start + 1}-01-01` ? !baseline : !endline
    let kind: Kind = 'followup'
    if (first && r.date < `${start + 1}-01-01`) {
      kind = 'baseline'
      baseline = true
    } else if (first) {
      kind = 'endline'
      endline = true
    }
    return { row: r, kind }
  })
}

function worstOf(l: Learner): string | null {
  if (!l.measuredOn) return null
  if (l.bmiBand && l.bmiBand !== 'Normal') return l.bmiBand
  if (l.hfaBand && l.hfaBand !== 'Normal' && l.hfaBand !== 'Tall') return l.hfaBand
  return 'Normal'
}

export function JourneyHeader({
  learner: l,
  record,
  adviser,
}: {
  learner: Learner
  record: ApiLearnerRecord
  adviser: string
}) {
  const name = [record.firstName, record.middleName, record.lastName, record.nameExt].filter(Boolean).join(' ')
  const initials = (record.firstName[0] ?? '') + (record.lastName[0] ?? '')
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div
        aria-hidden
        className="flex size-[52px] shrink-0 items-center justify-center rounded-[14px] bg-navy-900 font-display text-[17px] font-extrabold"
        style={{ color: Y }}
      >
        {initials.toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="font-display text-[21px] leading-tight font-extrabold tracking-[-0.01em] text-navy-900">
          {name}
        </h2>
        <p className="mt-0.5 text-[13px] text-muted">
          {l.section}
          {adviser ? ` · ${adviser}` : ''}
          {' · Stub ID '}
          <span className="font-mono">{l.stubId}</span>
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {!l.measuredOn ? (
          <Chip>Not measured</Chip>
        ) : (
          <>
            {l.bmiBand && <Chip color={BAND_COLOR[l.bmiBand]}>BMI · {l.bmiBand}</Chip>}
            {l.hfaBand && <Chip color={BAND_COLOR[l.hfaBand]}>Height · {l.hfaBand}</Chip>}
          </>
        )}
      </div>
    </div>
  )
}

function Chip({ color, children }: { color?: string; children: React.ReactNode }) {
  return (
    <span
      className={cx('rounded-full px-3 py-1 text-[12px] font-bold whitespace-nowrap', !color && 'text-muted')}
      style={
        color
          ? { color, background: `color-mix(in srgb, ${color} 9%, white)` }
          : { boxShadow: 'inset 0 0 0 1.5px var(--color-line)' }
      }
    >
      {children}
    </span>
  )
}

export function Journey({
  learner: l,
  record,
  schoolYear,
}: {
  learner: Learner
  record: ApiLearnerRecord
  schoolYear: string
}) {
  const start = schoolYearStart(schoolYear)
  const today = todayIso()
  const rows = useMemo(() => growthRows(record), [record])
  const ins = useMemo(() => weighIns(rows, start), [rows, start])

  const marks: Mark[] = []
  for (const { row, kind } of ins) {
    marks.push({
      key: `m${row.date}`,
      kind,
      at: positionOf(row.date, start),
      label: kind === 'baseline' ? 'Baseline' : kind === 'endline' ? 'Endline' : 'Follow-up',
      detail: `${shortDay(row.date)}${row.weight !== null ? ` · ${row.weight.toFixed(1)} kg` : ''}`,
    })
  }
  if (!ins.some((x) => x.kind === 'endline')) {
    marks.push({ key: 'due', kind: 'due', at: positionOf(`${start + 1}-01-15`, start), label: 'Endline', detail: 'Jan to May' })
  }
  if (!ins.some((x) => x.kind === 'baseline') && today < `${start + 1}-01-01`) {
    marks.push({ key: 'due-b', kind: 'due', at: positionOf(`${start}-07-15`, start), label: 'Baseline', detail: 'Not measured' })
  }
  const lower: Mark[] = []
  if (l.printedAt) {
    const d = isoDay(l.printedAt)
    if (d >= `${start}-06-01`) lower.push({ key: 'slip', kind: 'slip', at: positionOf(d, start), label: 'Slip printed', detail: shortDay(d) })
  }
  if (l.attendedAt) {
    const d = isoDay(l.attendedAt)
    if (d >= `${start}-06-01`) lower.push({ key: 'att', kind: 'attended', at: positionOf(d, start), label: 'Parent attended', detail: shortDay(d) })
  }

  const now = positionOf(today, start)
  const upper = laned(marks)
  const below = laned(lower)

  return (
    <div className="rounded-[16px] bg-wash px-5 pt-4 pb-3">
      <div className="mb-1 flex items-baseline justify-between">
        <h3 className="font-display text-[13.5px] font-extrabold text-navy-900">School year {schoolYear}</h3>
        <span className="text-[11.5px] text-muted">June to May</span>
      </div>
      <div className={cx('relative mx-2', below.length === 0 ? 'h-[98px]' : below.some((b) => b.lane === 1) ? 'h-[164px]' : 'h-[136px]')}>
        {/* Labels above the line. */}
        {upper.map(({ m, lane }) => (
          <Label key={m.key} m={m} top={lane === 0 ? 36 : 4} />
        ))}
        {/* The line: navy up to today, pale after. */}
        <div className="absolute top-[72px] right-0 left-0 h-[6px] rounded-full bg-line" />
        <div className="absolute top-[72px] left-0 h-[6px] rounded-full bg-navy-900" style={{ width: `${now * 100}%` }} />
        <div
          className="absolute top-[64px] h-[22px] w-[2px] -translate-x-1/2 rounded-full"
          style={{ left: `${now * 100}%`, background: Y }}
          title="Today"
        />
        {marks.map((m) => (
          <span
            key={`d-${m.key}`}
            className={cx('absolute top-[75px] -translate-x-1/2 -translate-y-1/2 rounded-full', DOT[m.kind])}
            style={{ left: `${m.at * 100}%` }}
          />
        ))}
        {/* The slip and the parent hang just under the line, so a slip
            printed days after a weigh-in does not sit on its dot. */}
        {lower.map((m) => (
          <span key={`d-${m.key}`} className="absolute top-[78px] -translate-x-1/2" style={{ left: `${m.at * 100}%` }}>
            <span className="mx-auto block h-[10px] w-px bg-navy-900/40" />
            <span className={cx('block rounded-full', DOT[m.kind])} />
          </span>
        ))}
        {/* Labels below the line. */}
        {below.map(({ m, lane }) => (
          <Label key={m.key} m={m} top={lane === 0 ? 102 : 130} />
        ))}
      </div>
      <div className="relative mx-2 h-4">
        {MONTHS.map((mo, i) => (
          <span
            key={mo}
            className="absolute -translate-x-1/2 text-[10.5px] text-muted"
            style={{ left: `${((i + 0.5) / 12) * 100}%` }}
          >
            {mo}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Two rows of labels on each side, so two events a few days apart do not
    print over each other. */
function laned(marks: Mark[]): { m: Mark; lane: number }[] {
  const sorted = [...marks].sort((a, b) => a.at - b.at)
  const last = [-1, -1]
  return sorted.map((m) => {
    const lane = m.at - last[0] >= 0.13 ? 0 : m.at - last[1] >= 0.13 ? 1 : 0
    last[lane] = m.at
    return { m, lane }
  })
}

function Label({ m, top }: { m: Mark; top: number }) {
  /* Kept inside the line's ends rather than centred past them. */
  const align = m.at < 0.06 ? 'translate-x-0' : m.at > 0.94 ? '-translate-x-full' : '-translate-x-1/2'
  const tone =
    m.kind === 'attended' ? 'text-[var(--color-n)]' : m.kind === 'followup' ? 'text-navy-700' : 'text-navy-900'
  return (
    <div className={cx('absolute text-center whitespace-nowrap', align)} style={{ left: `${m.at * 100}%`, top }}>
      <div className={cx('text-[11.5px] leading-tight font-bold', tone)}>{m.label}</div>
      <div className="tnum text-[10.5px] leading-tight text-muted">{m.detail}</div>
    </div>
  )
}

export function JourneyTiles({
  learner: l,
  record,
  schoolYear,
}: {
  learner: Learner
  record: ApiLearnerRecord
  schoolYear: string
}) {
  const start = schoolYearStart(schoolYear)
  const today = todayIso()
  const rows = useMemo(() => growthRows(record), [record])
  const ins = weighIns(rows, start)
  const first = ins[0]?.row
  const change =
    first && l.weightKg !== null && first.weight !== null && first.date !== l.measuredOn
      ? l.weightKg - first.weight
      : null

  const endlineRound = today >= `${start + 1}-01-01`
  const measuredThisRound = ins.some((x) => (endlineRound ? x.kind === 'endline' : x.kind === 'baseline'))
  const flagged = worstOf(l) !== null && worstOf(l) !== 'Normal'
  const next = !measuredThisRound
    ? { title: endlineRound ? 'Endline weigh-in' : 'Baseline weigh-in', note: 'Not measured' }
    : flagged && !l.printedAt
      ? { title: 'Print invitation slip', note: 'For follow-up' }
      : flagged && !l.attendedAt
        ? { title: 'Parent meeting', note: 'Invited, not attended' }
        : !endlineRound
          ? { title: 'Endline weigh-in', note: 'January to May' }
          : { title: 'None', note: 'School year complete' }

  const bmiBand = l.bmiZ !== null ? classifyBmiForAge(l.bmiZ) : null
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
      <Tile
        label="Height"
        value={l.heightCm !== null ? `${l.heightCm.toFixed(1)} cm` : '—'}
        note={l.hfaBand ? `${l.hfaBand} for age` : 'Not measured'}
      />
      <Tile
        label="Weight"
        value={l.weightKg !== null ? `${l.weightKg.toFixed(1)} kg` : '—'}
        note={
          change !== null
            ? `${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(1)} kg since ${shortDay(first!.date)}`
            : bmiBand
              ? `BMI ${bmiBand}`
              : 'Not measured'
        }
      />
      <Tile
        label="Immunization"
        value={IMMUNIZATION_LABEL[l.immunization]}
        tone={l.immunization === 'complete' ? 'text-[var(--color-n)]' : 'text-[var(--color-w)]'}
      />
      <Tile label="Next step" value={next.title} note={next.note} />
    </div>
  )
}

function Tile({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div className="rounded-[14px] px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className={cx('tnum mt-0.5 text-[15px] leading-snug font-bold text-navy-900', tone)}>{value}</div>
      {note && <div className="mt-0.5 text-[11.5px] text-muted">{note}</div>}
    </div>
  )
}
