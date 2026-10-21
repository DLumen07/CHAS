import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  CalendarBlank,
  CaretLeft,
  CaretRight,
  CheckCircle,
  Printer,
  Scales,
  UsersThree,
} from '@phosphor-icons/react'
import { Panel, IconChip, cx } from './ui'
import type { Learner } from '@/data/mock'
import type { Meeting } from '@/lib/records'

/* The calendar every dashboard carries.

   Same rule as the rest of the dashboards: nothing on it is a plan the app
   does not hold. A day is marked because something is on file for it - a
   learner measured that day, a slip run off, a parent scanned in at the door,
   or the meeting the slips name.
   There is no free-form "add event": the app has nowhere to keep one, and a
   calendar that forgets what was typed into it is worse than none.

   Counted from the roster the screen already holds, so an adviser's calendar
   is her class and the head's is the school, without a second query.

   "Today" is the wall clock, not the sample roster's session date. The
   calendar is the one panel where a reader checks the date itself. */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/* Structural colours only. The clinical scale (green, orange, rose, violet)
   belongs to nutritional status, so a dot here can never be read as a band. */
const MARK = {
  weighin: 'var(--color-navy-700)',
  slips: '#0891b2',
  attended: 'var(--color-gold-500)',
} as const

type MarkKind = keyof typeof MARK

const pad = (n: number) => String(n).padStart(2, '0')
const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** The local calendar day a stored value belongs to, or null if it has none. */
function dayOf(at: string | null | undefined): string | null {
  if (!at) return null
  if (at.includes('T')) {
    const d = new Date(at)
    return Number.isNaN(d.getTime()) ? at.slice(0, 10) : keyOf(d)
  }
  return /^\d{4}-\d{2}-\d{2}/.test(at) ? at.slice(0, 10) : null
}

function fromKey(k: string): Date {
  const [y, m, d] = k.split('-').map(Number)
  return new Date(y, m - 1, d)
}

interface DayTally {
  weighin: number
  slips: number
  attended: number
}

export default function CalendarPanel({
  learners,
  meeting,
  className,
  compact = false,
}: {
  learners: Learner[]
  meeting: Meeting | null
  className?: string
  /** A shorter card for a dashboard slot: no legend and no coming-up list;
      the selected day's events become one row of chips, and an empty day
      offers a jump to the next thing on file. */
  compact?: boolean
}) {
  const navigate = useNavigate()
  const todayKey = keyOf(new Date())
  const [cursor, setCursor] = useState(() => {
    const t = new Date()
    return new Date(t.getFullYear(), t.getMonth(), 1)
  })
  const [selected, setSelected] = useState(todayKey)

  const tally = useMemo(() => {
    const m = new Map<string, DayTally>()
    const bump = (k: string | null, kind: MarkKind) => {
      if (!k) return
      const t = m.get(k) ?? { weighin: 0, slips: 0, attended: 0 }
      t[kind]++
      m.set(k, t)
    }
    for (const l of learners) {
      bump(dayOf(l.measuredOn), 'weighin')
      bump(dayOf(l.printedAt), 'slips')
      bump(dayOf(l.attendedAt), 'attended')
    }
    return m
  }, [learners])

  const meetingKey = meeting && /^\d{4}-\d{2}-\d{2}$/.test(meeting.date) ? meeting.date : null

  /* Six rows always, so the panel does not change height from month to month
     and push the panels under it around. */
  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const start = new Date(first)
    start.setDate(1 - first.getDay())
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      return d
    })
  }, [cursor])

  const month = cursor.getMonth()
  const monthName = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  const moveBy = (days: number) => {
    const d = fromKey(selected)
    d.setDate(d.getDate() + days)
    goTo(keyOf(d))
    requestAnimationFrame(() =>
      document.querySelector<HTMLButtonElement>(`[data-day="${keyOf(d)}"]`)?.focus(),
    )
  }
  const onGridKey = (e: React.KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    if (step === undefined) return
    e.preventDefault()
    moveBy(step)
  }

  const shift = (n: number) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1))
  const goTo = (k: string) => {
    const d = fromKey(k)
    setCursor(new Date(d.getFullYear(), d.getMonth(), 1))
    setSelected(k)
  }

  /* What the reader most likely wants next when the month in view is quiet:
     the meeting if it is still ahead, otherwise the latest day with work on
     file. Offered as a jump, never as a guess drawn into the grid. */
  const latestWork = useMemo(() => {
    let best: string | null = null
    for (const k of tally.keys()) if (k <= todayKey && (!best || k > best)) best = k
    return best
  }, [tally, todayKey])

  const upcoming: { key: string; label: string; icon: ReactNode }[] = []
  if (meetingKey && meetingKey >= todayKey) {
    upcoming.push({
      key: meetingKey,
      label: 'Parent meeting',
      icon: <UsersThree size={12} weight="fill" />,
    })
  }
  if (upcoming.length === 0 && latestWork) {
    upcoming.push({
      key: latestWork,
      label: 'Latest recorded work',
      icon: <Scales size={12} weight="fill" />,
    })
  }
  upcoming.sort((a, b) => a.key.localeCompare(b.key))

  const sel = tally.get(selected)
  const selDate = fromKey(selected)

  const agenda: { icon: ReactNode; tone: string; text: ReactNode; short: string; to?: string; go?: string }[] = []
  if (selected === meetingKey && meeting) {
    agenda.push({
      icon: <UsersThree size={13} weight="fill" />,
      tone: 'bg-seal-yellow text-navy-950',
      text: (
        <>
          <span className="font-semibold text-navy-900">Parent meeting</span>
          <span className="block truncate text-muted">
            {meeting.time} &middot; {meeting.venue}
          </span>
        </>
      ),
      short: `Meeting ${meeting.time}`,
      to: '/attendance',
      go: 'Door',
    })
  }
  if (sel?.weighin) {
    agenda.push({
      icon: <Scales size={13} weight="fill" />,
      tone: 'bg-navy-50 text-navy-700',
      text: (
        <>
          <span className="tnum font-semibold text-navy-900">{sel.weighin}</span> measured
        </>
      ),
      short: `${sel.weighin} weighed`,
      to: '/weigh-in',
      go: 'Weigh-in',
    })
  }
  if (sel?.slips) {
    agenda.push({
      icon: <Printer size={13} weight="fill" />,
      tone: 'bg-[#e0f5f9] text-[#0e7490]',
      text: (
        <>
          <span className="tnum font-semibold text-navy-900">{sel.slips}</span> invitation
          {sel.slips === 1 ? '' : 's'} printed
        </>
      ),
      short: `${sel.slips} slip${sel.slips === 1 ? '' : 's'}`,
      to: '/slips',
      go: 'Slips',
    })
  }
  if (sel?.attended) {
    agenda.push({
      icon: <CheckCircle size={13} weight="fill" />,
      tone: 'bg-gold-100 text-gold-700',
      text: (
        <>
          <span className="tnum font-semibold text-navy-900">{sel.attended}</span> parent
          {sel.attended === 1 ? '' : 's'} attended
        </>
      ),
      short: `${sel.attended} attended`,
      to: '/attendance',
      go: 'Log',
    })
  }
  const thisMonth = cursor.getFullYear() === new Date().getFullYear() && month === new Date().getMonth()

  return (
    <Panel
      className={className}
      bodyClass="flex min-h-0 flex-1 flex-col px-4 pb-4"
      title={
        <span className="flex items-center gap-2">
          <IconChip tone="gold">
            <CalendarBlank size={14} weight="fill" />
          </IconChip>
          {compact ? monthName : 'Calendar'}
        </span>
      }
      actions={
        <>
          {(!thisMonth || selected !== todayKey) && (
            <button
              type="button"
              onClick={() => goTo(todayKey)}
              className="rounded-full bg-wash px-2.5 py-1 text-[11px] font-medium text-navy-800 transition-colors duration-100 hover:bg-navy-50"
            >
              Today
            </button>
          )}
          {compact && (
            <span className="flex items-center">
              <button
                type="button"
                onClick={() => shift(-1)}
                aria-label="Previous month"
                className="grid size-7 place-items-center rounded-full text-muted transition-colors duration-100 hover:bg-wash hover:text-navy-900"
              >
                <CaretLeft size={13} weight="bold" />
              </button>
              <button
                type="button"
                onClick={() => shift(1)}
                aria-label="Next month"
                className="grid size-7 place-items-center rounded-full text-muted transition-colors duration-100 hover:bg-wash hover:text-navy-900"
              >
                <CaretRight size={13} weight="bold" />
              </button>
            </span>
          )}
        </>
      }
    >
      {/* Month switcher (full size only; compact carries it in the header) */}
      {!compact && (
      <div className="flex items-center justify-between pb-2">
        <button
          type="button"
          onClick={() => shift(-1)}
          aria-label="Previous month"
          className="grid size-7 place-items-center rounded-full text-muted transition-colors duration-100 hover:bg-wash hover:text-navy-900"
        >
          <CaretLeft size={13} weight="bold" />
        </button>
        <span className="text-[12.5px] font-semibold text-navy-900">{monthName}</span>
        <button
          type="button"
          onClick={() => shift(1)}
          aria-label="Next month"
          className="grid size-7 place-items-center rounded-full text-muted transition-colors duration-100 hover:bg-wash hover:text-navy-900"
        >
          <CaretRight size={13} weight="bold" />
        </button>
      </div>
      )}

      {/* The grid */}
      <div
        className={cx('grid grid-cols-7 text-center', compact ? 'gap-y-0' : 'gap-y-0.5')}
        role="grid"
        aria-label={monthName}
        onKeyDown={onGridKey}
      >
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="pb-0.5 text-[9.5px] font-semibold tracking-[0.06em] text-placeholder uppercase"
          >
            {w.slice(0, 2)}
          </div>
        ))}
        {cells.map((d) => {
          const k = keyOf(d)
          const inMonth = d.getMonth() === month
          const t = tally.get(k)
          const isToday = k === todayKey
          const isSel = k === selected
          const isMeeting = k === meetingKey
          const marks = (Object.keys(MARK) as MarkKind[]).filter((m) => (t?.[m] ?? 0) > 0)
          const label = [
            d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
            isMeeting && 'parent meeting',
            t?.weighin && `${t.weighin} measured`,
            t?.slips && `${t.slips} slips printed`,
            t?.attended && `${t.attended} parents attended`,
          ]
            .filter(Boolean)
            .join(', ')

          return (
            <div
              key={k}
              className={cx('flex justify-center', compact ? 'py-0' : 'py-px')}
            >
              <button
                type="button"
                onClick={() => setSelected(k)}
                data-day={k}
                tabIndex={isSel ? 0 : -1}
                title={label}
                aria-label={label}
                aria-pressed={isSel}
                className={cx(
                  'relative flex w-full max-w-[40px] focus-ring', compact ? 'h-[22px]' : 'h-[34px]', 'flex-col items-center justify-center rounded-[9px]',
                  'tnum text-[11.5px] transition-colors duration-100',
                  isSel
                    ? 'bg-navy-900 font-semibold text-white'
                    : isMeeting
                      ? 'bg-seal-yellow font-semibold text-navy-950 hover:bg-seal-yellow-hover'
                      : inMonth
                        ? 'text-navy-900 hover:bg-wash'
                        : 'text-placeholder/60 hover:bg-wash',
                  isToday && !isSel && 'shadow-[inset_0_0_0_1.5px_var(--color-navy-600)]',
                )}
              >
                <span className="leading-none">{d.getDate()}</span>
                <span className={cx('flex h-[4px] gap-[2px]', compact ? 'mt-px' : 'mt-[3px]')}>
                  {marks.map((m) => (
                    <span
                      key={m}
                      className="size-[4px] rounded-full"
                      style={{ background: isSel ? '#fff' : MARK[m] }}
                    />
                  ))}
                </span>
              </button>
            </div>
          )
        })}
      </div>

      {/* Legend */}
      {!compact && (
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft pb-2.5 text-[10px] text-muted">
        <LegendDot color={MARK.weighin}>Weigh-in</LegendDot>
        <LegendDot color={MARK.slips}>Slips</LegendDot>
        <LegendDot color={MARK.attended}>Attended</LegendDot>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-seal-yellow" />
          Meeting
        </span>
      </div>
      )}

      {compact && (
        <div className="mt-auto flex min-w-0 items-center gap-2 border-t border-line-soft pt-2">
          <span className="shrink-0 text-[11.5px] font-semibold text-navy-900">
            {selected === todayKey ? 'Today' : selDate.toLocaleDateString(undefined, { weekday: 'short' })}
            <span className="ml-1 font-normal text-muted">
              {selDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          </span>
          {agenda.length > 0 ? (
            <span className="flex min-w-0 flex-1 justify-end gap-1 overflow-hidden">
              {agenda.slice(0, 2).map((a, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => a.to && navigate(a.to)}
                  title={a.short}
                  className={cx(
                    'flex min-w-0 items-center gap-1 rounded-full py-0.5 pr-2 pl-1 text-[10.5px] font-medium transition-[filter] duration-100 hover:brightness-95 [&_svg]:size-3',
                    a.tone,
                  )}
                >
                  {a.icon}
                  <span className="truncate">{a.short}</span>
                </button>
              ))}
            </span>
          ) : upcoming[0] && upcoming[0].key !== selected ? (
            <button
              type="button"
              onClick={() => goTo(upcoming[0].key)}
              className="ml-auto flex min-w-0 items-center gap-1 text-[11px] font-medium text-navy-700 hover:text-navy-900"
            >
              <span className="truncate">
                {upcoming[0].label} &middot;{' '}
                {fromKey(upcoming[0].key).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
              <ArrowRight size={10} weight="bold" className="shrink-0" />
            </button>
          ) : (
            <span className="ml-auto truncate text-[11px] text-muted">No events</span>
          )}
        </div>
      )}

      {/* The selected day */}
      {!compact && (
      <div className="pt-2.5">
        <div className="mb-1.5 text-[10px] font-semibold tracking-[0.07em] text-placeholder uppercase">
          {selected === todayKey
            ? 'Today'
            : selDate.toLocaleDateString(undefined, { weekday: 'long' })}
          <span className="ml-1.5 tracking-normal normal-case">
            {selDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        </div>
        {agenda.length === 0 ? (
          <p className="rounded-[10px] bg-wash px-3 py-2 text-[11px] text-muted">
            No events on this day.
          </p>
        ) : (
          <ul className="space-y-1">
            {agenda.map((a, i) => (
              <li key={i} className="flex items-center gap-2.5 rounded-[10px] px-1 py-1 text-[11.5px]">
                <span className={cx('grid size-7 shrink-0 place-items-center rounded-[8px]', a.tone)}>
                  {a.icon}
                </span>
                <span className="min-w-0 flex-1 leading-snug text-navy-900">{a.text}</span>
                {a.to && (
                  <button
                    type="button"
                    onClick={() => navigate(a.to as string)}
                    className="flex shrink-0 items-center gap-0.5 text-[10.5px] font-medium text-navy-700 hover:text-navy-900"
                  >
                    {a.go}
                    <ArrowRight size={10} weight="bold" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      )}

      {/* Coming up */}
      {!compact && (upcoming.length > 0 || !meetingKey) && (
        <div className="mt-auto pt-3">
          <div className="mb-1.5 text-[10px] font-semibold tracking-[0.07em] text-placeholder uppercase">
            {upcoming.some((u) => u.key >= todayKey) ? 'Upcoming' : 'Jump to'}
          </div>
          <ul className="space-y-1">
            {upcoming.slice(0, 3).map((u) => (
              <li key={`${u.key}-${u.label}`}>
                <button
                  type="button"
                  onClick={() => goTo(u.key)}
                  className="flex w-full items-center gap-2 rounded-[8px] px-1.5 py-1 text-left text-[11px] transition-colors duration-100 hover:bg-wash"
                >
                  <span className="text-placeholder">{u.icon}</span>
                  <span className="min-w-0 flex-1 truncate text-navy-900">{u.label}</span>
                  <span className="tnum shrink-0 text-muted">
                    {fromKey(u.key).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                </button>
              </li>
            ))}
            {!meetingKey && (
              <li>
                <button
                  type="button"
                  onClick={() => navigate('/slips')}
                  className="flex w-full items-center gap-2 rounded-[8px] bg-gold-100 px-2 py-1.5 text-left text-[11px] text-gold-700 transition-colors duration-100 hover:bg-[#f8e5bd]"
                >
                  <UsersThree size={12} weight="fill" />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    No parent meeting set
                  </span>
                  <span className="flex shrink-0 items-center gap-0.5 font-semibold">
                    Set meeting <ArrowRight size={10} weight="bold" />
                  </span>
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
    </Panel>
  )
}

function LegendDot({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-[6px] rounded-full" style={{ background: color }} />
      {children}
    </span>
  )
}
