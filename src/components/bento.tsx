import { useContext, useMemo, useState, type ReactNode } from 'react'
import {
  Ticket,
  CalendarBlank,
  CaretRight,
  ChartLine,
  HeartStraight,
  Printer,
  Scales,
  Siren,
  Syringe,
  Warning,
} from '@phosphor-icons/react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { IconChip, cx, type Tone } from './ui'
import { AXIS_TICK, ChartTip, GRID, WrapTick, useGradientId } from './charts'
import { HeaderSlot } from './headerSlot'
import type { Learner } from '@/data/mock'
import { SERVER_BACKED, type Meeting } from '@/lib/records'
import { endpoints } from '@/lib/api'
import { isFlagged as offNormal } from '@/lib/filters'
import { pct } from '@/lib/summary'
import { BAND_COLOR, BMI_BANDS, HFA_BANDS, assess } from '@/lib/nutrition'
import { useQuery } from '../lib/query'
import { todayIso } from '@/lib/dates'

/* The dashboard kit: the bento grid's cards, used by the nurse's Health
   overview and kept here so any future dashboard reuses them.

   The look, in one place: white cards with no outline and a soft shadow on
   the grey-blue ground; a royal-to-navy banner; pill buttons; the seal's
   yellow for the one action on a screen; navy and royal blue for structure.
   The clinical colours appear only where they name a nutritional band. */

export const Y = '#ffde17'
export const NAVY = '#0e2464'
export const ROYAL = '#1e3fa0'
export const ROYAL_SOFT = '#9db5f0'
export const MIST = '#dbe3f3'
const BLUE_GRADIENT = 'linear-gradient(120deg, #2b52c4 0%, #1b3a92 55%, #0e2464 100%)'

/** Measured, and off Normal on either index - the app-wide rule. */
export const isFlagged = (l: Learner) => Boolean(l.measuredOn) && offNormal(l)

export type FollowState = 'need-slip' | 'slip-out' | 'attended'

export const followOf = (l: Learner): FollowState =>
  l.slip === 'attended' ? 'attended' : l.slip === 'printed' ? 'slip-out' : 'need-slip'

export function followCounts(flagged: Learner[]): Record<FollowState, number> {
  const c: Record<FollowState, number> = { 'need-slip': 0, 'slip-out': 0, attended: 0 }
  for (const l of flagged) c[followOf(l)]++
  return c
}

export const FOLLOW: Record<FollowState, { label: string; dot: string; ring: string; text: string }> = {
  'need-slip': { label: 'Not yet invited', dot: '#e8912d', ring: 'shadow-[inset_0_0_0_1px_#f2c894]', text: 'text-[#a95f0f]' },
  'slip-out': { label: 'Invited', dot: ROYAL, ring: 'shadow-[inset_0_0_0_1px_#c3d1f3]', text: 'text-navy-700' },
  attended: { label: 'Attended', dot: 'var(--color-gold-500)', ring: 'shadow-[inset_0_0_0_1px_#f0d67a]', text: 'text-[#8a5d0d]' },
}

/** Worst first: severe bands, then two problems, then one. */
export function severity(l: Learner): number {
  const w = (b: string | null) =>
    !b || b === 'Normal' || b === 'Tall' ? 0 : b.startsWith('Severely') || b === 'Obese' ? 3 : 2
  return w(l.bmiBand) + w(l.hfaBand)
}

/** The band a flagged learner is listed under: BMI first, then height. */
export const bandOf = (l: Learner) =>
  [l.bmiBand, l.hfaBand].find((b) => b === 'Severely Wasted' || b === 'Severely Stunted' || b === 'Obese') ??
  [l.bmiBand, l.hfaBand].find((b) => b && b !== 'Normal') ??
  null

export const shortDate = (iso: string) =>
  /^\d{4}-\d{2}-\d{2}/.test(iso)
    ? new Date(`${iso.slice(0, 10)}T00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : iso

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/* --- Surfaces ------------------------------------------------------------- */

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('panel flex flex-col px-5 pt-4 pb-5', className)}>{children}</section>
}

export function CardHead({
  icon,
  tone,
  eyebrow,
  title,
  onGo,
  goLabel,
}: {
  icon: ReactNode
  tone: Tone
  eyebrow: string
  title: string
  onGo?: () => void
  goLabel?: string
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <IconChip tone={tone}>{icon}</IconChip>
        <div className="min-w-0">
          <h3 className="truncate text-[14px] font-semibold tracking-[-0.01em] text-navy-900">{title}</h3>
          <div className="truncate text-[11.5px] text-muted">{eyebrow}</div>
        </div>
      </div>
      {onGo && (
        <button
          type="button"
          onClick={onGo}
          aria-label={goLabel}
          title={goLabel}
          className="grid size-8 shrink-0 place-items-center rounded-full bg-wash text-navy-800 transition-colors duration-100 hover:bg-navy-50"
        >
          <CaretRight size={13} weight="bold" />
        </button>
      )}
    </div>
  )
}

export function Legend({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-2.5 rounded-[3px]" style={{ background: color }} />
      {children}
    </span>
  )
}

/* --- Layout ------------------------------------------------------------------
   The bento: the main column (banner, row one, row two) beside a full-height
   rail. On xl the rail is held to the work area's own height, so it opens and
   closes on the same lines as the sidebar across the window. */

export function BentoPage({ children, rail }: { children: ReactNode; rail: ReactNode }) {
  /* The header belongs to this column, not to the window: it scrolls away
     with the cards, and the rail beside it keeps the top line to itself. */
  const takeHeader = useContext(HeaderSlot)

  return (
    /* The page scrolls as one, rail included. What the rail does not do is
       take its height from the cards beside it: it is cut to the window, so
       it opens on the sidebar's top line and closes on its bottom one
       instead of running off the screen. Narrow: one column, the rail last. */
    <div className="h-full overflow-auto px-6 pt-3 pb-6 xl:pb-3">
      {/* A window tall at least - measured against the scrolling area rather
          than the viewport, so a folded sidebar or a zoomed window cannot
          leave the rail short of the bottom line. */}
      <div className="grid grid-cols-1 gap-4 xl:min-h-full xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <div ref={takeHeader ?? undefined} />
          {children}
        </div>
        {/* It takes the row's height: a window when the cards fit, longer
            when they run past it. The caseload takes the slack, so the
            meeting card sits on the last line with nothing under it. */}
        <div className="flex flex-col gap-3 xl:h-0 xl:min-h-full">{rail}</div>
      </div>
    </div>
  )
}

export function Banner({
  name,
  title,
  summary,
  onStart,
}: {
  name?: string | undefined
  /** In place of the greeting: the head's banner names the school. */
  title?: string
  summary: string
  onStart: () => void
}) {
  return (
    <section className="relative overflow-hidden rounded-[18px] px-6 py-5 text-white" style={{ background: BLUE_GRADIENT }}>
      <span aria-hidden className="pointer-events-none absolute -top-16 -right-10 size-56 rounded-full bg-white/8" />
      <span aria-hidden className="pointer-events-none absolute -right-24 -bottom-24 size-64 rounded-full bg-white/6" />
      <div className="relative flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <span className="tnum inline-flex items-center gap-2 rounded-full bg-white/14 px-3 py-1 text-[11.5px] font-medium">
            <CalendarBlank size={13} weight="fill" />
            {new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
          <h2 className="mt-3 truncate font-display text-[28px] leading-none font-semibold tracking-[-0.02em]">
            {title ?? `${greeting()}${name ? `, ${name}` : ''}`}
          </h2>
          <p className="mt-1.5 text-[12.5px] text-white/80">{summary}</p>
        </div>
        <button
          type="button"
          onClick={onStart}
          className="flex h-9 items-center gap-2 rounded-full px-4 text-[12px] font-semibold text-[#071539] transition-[filter] duration-100 hover:brightness-95 active:translate-y-px"
          style={{ background: Y }}
        >
          <Scales size={15} weight="bold" />
          Start weigh-in
        </button>
      </div>
    </section>
  )
}

/* --- The bar card --------------------------------------------------------------
   Soft rounded bars with the value printed at the top, one picked out in the
   royal blue. Hover or click picks another; the line under the bars says what
   the picked one is. An optional dashed rule marks an average. */

export interface Bar {
  key: string
  label: string
  /** 0-100, the bar's height and the figure printed on it. */
  share: number
  /** Said on hover and to a screen reader. */
  title: string
  /** The line under the chart while this bar is picked. */
  detail: ReactNode
  /** A small dot under the label - a band's clinical colour, where the bar is one. */
  dot?: string
}

export function BarsCard({
  label,
  value,
  sub,
  bars,
  defaultKey,
  avg,
  avgLabel,
  aside,
  actions,
}: {
  label: string
  value: string
  sub: string
  bars: Bar[]
  defaultKey: string | null
  avg?: number
  avgLabel?: string
  aside?: ReactNode
  /** Controls in the header corner - an index switch, say. */
  actions?: ReactNode
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const active = bars.find((b) => b.key === picked) ?? bars.find((b) => b.key === defaultKey) ?? null
  const barFill = useGradientId('bars')

  return (
    <Card className="h-full gap-4 lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[11.5px] font-medium text-muted">{label}</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="tnum font-display text-[30px] leading-none font-semibold tracking-[-0.03em] text-navy-900">
                {value}
              </span>
              <span className="tnum truncate text-[11.5px] text-muted">{sub}</span>
            </div>
          </div>
          {actions}
        </div>

        {bars.length === 0 ? (
          <p className="my-auto py-6 text-center text-[12px] text-muted">No data to display.</p>
        ) : (
          <div className="relative mt-auto pt-3" onMouseLeave={() => setPicked(null)}>
            {/* Recharts since 2026-10-10. Bars are drawn to their true height
                - the old hand-drawn bars had a 26% floor, which made 4% and
                21% look alike - and the axis is scaled to the largest bar so
                small shares still read. */}
            <ResponsiveContainer width="100%" height={136}>
              <BarChart data={bars} margin={{ top: 18, right: 4, left: 4, bottom: 0 }} barCategoryGap="16%">
                <defs>
                  <linearGradient id={barFill} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#2b52c4" />
                    <stop offset="100%" stopColor={ROYAL} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                  height={36}
                  tick={<WrapTick activeLabel={active?.label ?? null} />}
                />
                <YAxis hide domain={[0, (max: number) => Math.max(10, Math.ceil((max + 4) / 10) * 10)]} />
                <Tooltip content={() => null} cursor={{ fill: 'var(--color-wash)', radius: 12 }} />
                {avg !== undefined && (
                  <ReferenceLine y={avg} stroke="#2b52c4" strokeOpacity={0.55} strokeDasharray="4 4" ifOverflow="extendDomain" />
                )}
                <Bar
                  dataKey="share"
                  radius={[10, 10, 10, 10]}
                  maxBarSize={46}
                  minPointSize={4}
                  onMouseEnter={(_: unknown, i: number) => setPicked(bars[i]?.key ?? null)}
                  onClick={(_: unknown, i: number) => setPicked(bars[i]?.key ?? null)}
                >
                  {bars.map((b) => (
                    <Cell key={b.key} cursor="pointer" fill={active?.key === b.key ? `url(#${barFill})` : '#dae2f8'} />
                  ))}
                  <LabelList
                    dataKey="share"
                    position="top"
                    formatter={(v: unknown) => `${v}%`}
                    style={{ fontSize: 10.5, fontWeight: 600, fill: NAVY }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-line-soft pt-2.5 text-[11px]">
              <span className="tnum min-w-0 truncate text-navy-900">{active?.detail}</span>
              {avg !== undefined && (
                <span className="flex shrink-0 items-center gap-1.5 text-muted">
                  <span className="w-4 border-t border-dashed border-navy-600/60" />
                  {avgLabel ?? 'average'}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
      {aside}
    </Card>
  )
}

/* --- The blue box: normal against needs monitoring ----------------------- */

export function StatusSplit({
  healthy,
  needsMonitoring,
  measured,
}: {
  healthy: number
  needsMonitoring: number
  measured: number
}) {
  return (
    <div
      className="flex shrink-0 flex-col gap-2.5 rounded-[26px] p-2.5 text-white lg:w-[150px]"
      style={{ background: `linear-gradient(160deg, ${ROYAL} 0%, ${NAVY} 100%)` }}
    >
      <div className="px-3 pt-2 pb-0.5">
        <div className="flex items-center justify-between">
          <span className="grid size-7 place-items-center rounded-full bg-white/15">
            <HeartStraight size={13} weight="fill" />
          </span>
          <span className="tnum text-[11px] font-semibold">{healthy} learners</span>
        </div>
        <div className="mt-1.5">
          <span className="tnum block font-display text-[26px] leading-none font-medium">{pct(healthy, measured)}%</span>
          <span className="mt-0.5 block text-[10.5px] leading-tight text-white/80">normal</span>
        </div>
      </div>
      <div className="rounded-[20px] bg-white px-3 py-2.5 text-navy-900">
        <div className="flex items-center justify-between">
          <span className="grid size-7 place-items-center rounded-full bg-[#e5ecfb] text-navy-700">
            <Warning size={13} weight="fill" />
          </span>
          <span className="tnum text-[11px] font-semibold text-navy-700">{needsMonitoring} learners</span>
        </div>
        <div className="mt-1.5">
          <span className="tnum block font-display text-[26px] leading-none font-medium">{pct(needsMonitoring, measured)}%</span>
          <span className="mt-0.5 block text-[10.5px] leading-tight text-muted">need monitoring</span>
        </div>
      </div>
    </div>
  )
}

/* --- Caseload ------------------------------------------------------------------
   Three rows, because each needs a different response: feeding, referral,
   diet counselling. Severe cases are counted inside their row and named. */

export function CaseloadCard({ flagged }: { flagged: Learner[] }) {
  const rows = [
    {
      label: 'Wasted',
      n: flagged.filter((l) => l.bmiBand === 'Wasted' || l.bmiBand === 'Severely Wasted').length,
      severe: flagged.filter((l) => l.bmiBand === 'Severely Wasted').length,
      color: BAND_COLOR.Wasted,
    },
    {
      label: 'Stunted',
      n: flagged.filter((l) => l.hfaBand === 'Stunted' || l.hfaBand === 'Severely Stunted').length,
      severe: flagged.filter((l) => l.hfaBand === 'Severely Stunted').length,
      color: BAND_COLOR['Severely Stunted'],
    },
    {
      label: 'Overweight',
      n: flagged.filter((l) => l.bmiBand === 'Overweight' || l.bmiBand === 'Obese').length,
      severe: flagged.filter((l) => l.bmiBand === 'Obese').length,
      color: BAND_COLOR.Overweight,
    },
  ]
  const max = Math.max(1, ...rows.map((r) => r.n))

  return (
    <Card className="h-full">
      <CardHead icon={<Warning size={14} weight="fill" />} tone="red" eyebrow={`${flagged.length} flagged learners`} title="Caseload" />
      <ul className="mt-5 space-y-4">
        {rows.map((r) => (
          <li key={r.label}>
            <div className="flex items-baseline justify-between text-[12px]">
              <span className="font-medium text-navy-900">{r.label}</span>
              <span className="tnum">
                <span className="text-[15px] font-semibold text-navy-900">{r.n}</span>
                {r.severe > 0 && <span className="ml-1.5 text-[10.5px] text-muted">{r.severe} severe</span>}
              </span>
            </div>
            <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-wash">
              <div className="h-full rounded-full" style={{ width: `${(r.n / max) * 100}%`, background: r.color }} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/* --- Parent follow-up, one stripe per flagged learner --------------------- */

export function FollowUpCard({
  flagged,
  counts,
  onGo,
  meeting,
}: {
  flagged: Learner[]
  counts: Record<FollowState, number>
  onGo: () => void
  /** When given, the next parent meeting is stated under the legend. */
  meeting?: Meeting | null
}) {
  const order: FollowState[] = ['attended', 'slip-out', 'need-slip']
  const stripes = [...flagged].sort((a, b) => order.indexOf(followOf(a)) - order.indexOf(followOf(b)))
  const color: Record<FollowState, string> = { attended: Y, 'slip-out': ROYAL_SOFT, 'need-slip': MIST }

  return (
    <Card className="h-full">
      <CardHead icon={<Printer size={14} weight="fill" />} tone="navy" eyebrow="Invitation slips" title="Parent follow-up" onGo={onGo} goLabel="Invitation slips" />
      <div className="mt-4 flex items-baseline justify-between text-[11px] text-navy-900">
        <span>
          <span className="tnum font-semibold">{counts.attended}</span> of <span className="tnum">{flagged.length}</span>{' '}
          parents attended
        </span>
        <span className="tnum font-display text-[22px] leading-none font-semibold">{pct(counts.attended, flagged.length)}%</span>
      </div>
      {flagged.length === 0 ? (
        <p className="my-auto py-4 text-center text-[12px] text-muted">No flagged learners.</p>
      ) : (
        <div className="mt-2 flex h-[64px] items-stretch gap-[3px]">
          {stripes.map((l) => (
            <span
              key={l.id}
              title={`${l.firstName} ${l.lastName} - ${FOLLOW[followOf(l)].label}`}
              className="min-w-[2px] max-w-[12px] flex-1 rounded-full"
              style={{ background: color[followOf(l)] }}
            />
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-muted">
        <Legend color={Y}>Attended {counts.attended}</Legend>
        <Legend color={ROYAL_SOFT}>Invited {counts['slip-out']}</Legend>
        <Legend color={MIST}>Not yet invited {counts['need-slip']}</Legend>
      </div>
      {meeting !== undefined && (
        <div className="mt-3.5 flex items-center gap-2 rounded-[12px] bg-wash px-3 py-2 text-[11.5px] text-navy-900">
          <CalendarBlank size={13} weight="fill" className="shrink-0 text-navy-700" />
          {meeting && meeting.date >= todayIso() ? (
            <span>
              Next parent meeting: <span className="font-semibold">{shortDate(meeting.date)}</span>
            </span>
          ) : (
            <span className="text-muted">No parent meeting scheduled</span>
          )}
        </div>
      )}
    </Card>
  )
}

/* --- Immunization, as the semicircle ------------------------------------------ */

export function ImmunizationCard({
  counts,
  onGo,
}: {
  counts: { complete: number; incomplete: number; none: number }
  onGo: () => void
}) {
  const total = counts.complete + counts.incomplete + counts.none
  return (
    <GaugeCard
      icon={<Syringe size={14} weight="fill" />}
      tone="blue"
      title="Immunization"
      eyebrow="All learners"
      segments={[
        { label: 'Complete', n: counts.complete, color: ROYAL },
        { label: 'Incomplete', n: counts.incomplete, color: 'var(--color-gold-500)' },
        { label: 'No card', n: counts.none, color: MIST },
      ]}
      centerValue={`${pct(counts.complete, total)}%`}
      centerLabel="complete"
      onGo={onGo}
      goLabel="Open learners"
    />
  )
}

/* --- The rail: a filtered list of learners, with the meeting under it ----- */

export interface RailTab {
  key: string
  label: string
  count?: number
  test: (l: Learner) => boolean
}

export function LearnerRail({
  icon,
  tone = 'gold',
  title,
  subtitle,
  learners,
  tabs,
  sort,
  meta,
  badge,
  onOpen,
  footer,
}: {
  icon: ReactNode
  tone?: Tone
  title: string
  subtitle: string
  learners: Learner[]
  tabs: RailTab[]
  sort: (a: Learner, b: Learner) => number
  meta: (l: Learner) => ReactNode
  badge: (l: Learner) => ReactNode
  onOpen: (l: Learner) => void
  footer?: ReactNode
}) {
  const [tab, setTab] = useState(tabs[0]?.key)
  const current = tabs.find((t) => t.key === tab) ?? tabs[0]
  const rows = learners.filter((l) => !current || current.test(l)).sort(sort)

  return (
    <aside className="panel flex h-full min-h-[560px] flex-col p-4 xl:min-h-0">
      <div className="flex items-center gap-2.5 px-1">
        <IconChip tone={tone}>{icon}</IconChip>
        <div className="min-w-0">
          <h3 className="truncate text-[14px] font-semibold tracking-[-0.01em] text-navy-900">{title}</h3>
          <div className="truncate text-[11.5px] text-muted">{subtitle}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-pressed={current?.key === t.key}
            className={cx(
              'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors duration-100',
              current?.key === t.key ? 'bg-navy-800 text-white' : 'bg-wash text-muted hover:text-navy-900',
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="tnum ml-1 opacity-70">{t.count}</span>}
          </button>
        ))}
      </div>

      <ul className="mt-3 min-h-[200px] flex-1 space-y-1 overflow-auto pr-1">
        {rows.length === 0 ? (
          <li className="py-8 text-center text-[12px] text-muted">No learners in this list.</li>
        ) : (
          rows.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                onClick={() => onOpen(l)}
                className="flex w-full items-center gap-2.5 rounded-[12px] px-2 py-2 text-left transition-colors duration-100 hover:bg-wash"
              >
                <span
                  className={cx(
                    'grid size-9 shrink-0 place-items-center rounded-full text-[11px] font-semibold',
                    l.sex === 'F' ? 'bg-[#fbe3ee] text-[#9d174d]' : 'bg-[#e0f2fe] text-[#075985]',
                  )}
                >
                  {l.firstName[0]}
                  {l.lastName[0]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-navy-900">
                    {l.firstName} {l.lastName}
                  </span>
                  <span className="block truncate text-[10.5px] text-muted">{meta(l)}</span>
                </span>
                {badge(l)}
              </button>
            </li>
          ))
        )}
      </ul>

      {footer}
    </aside>
  )
}

/** A follow-up status pill for a flagged learner. */
export function FollowPill({ l }: { l: Learner }) {
  const f = FOLLOW[followOf(l)]
  return (
    <span className={cx('flex shrink-0 items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-medium', f.ring, f.text)}>
      <span className="size-1.5 rounded-full" style={{ background: f.dot }} />
      {f.label}
    </span>
  )
}

/** The band name, in its clinical colour. */
export function BandText({ l }: { l: Learner }) {
  const band = bandOf(l)
  return band ? <span style={{ color: BAND_COLOR[band as keyof typeof BAND_COLOR] }}>{band}</span> : null
}

/* --- Upcoming event, at the foot of a rail ----------------------------------
   The next dated thing CHAS holds that is still ahead: the parent meeting the
   slips name. Only events the app actually has - there is nowhere to keep a free-form one, so
   none is invented. With nothing ahead, the card offers to set the meeting. */

interface UpcomingEvent {
  key: string
  date: string
  title: string
  lines: { label: string; value: string }[]
  action: { label: string; icon: ReactNode; onGo: () => void }
}

function countdown(date: string): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(`${date.slice(0, 10)}T00:00`)
  const days = Math.round((d.getTime() - today.getTime()) / 864e5)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return `In ${days} days`
}

export function UpcomingEventCard({
  meeting,
  onDoor,
  onSet,
  standalone,
  fill,
}: {
  meeting: Meeting | null
  onDoor: () => void
  onSet: () => void
  /** A card of its own, rather than a strip inside the rail. */
  standalone?: boolean
  /** Stretch to the row's height - for a card sitting in the bento grid. */
  fill?: boolean
}) {

  /* Under a rail the card is held to half the height of the card it answers
     to across the page, so the caseload above it keeps the rest. At that
     height the meeting shows its date and its door button; the time and the
     venue are a click away rather than squeezed in. */
  const short = Boolean(standalone) && !fill

  const now = new Date()
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  const events: UpcomingEvent[] = []
  if (meeting && /^\d{4}-\d{2}-\d{2}$/.test(meeting.date) && meeting.date >= todayKey) {
    events.push({
      key: 'meeting',
      date: meeting.date,
      title: 'Parent meeting',
      lines: [
        { label: 'Time', value: meeting.time },
        { label: 'Venue', value: meeting.venue },
      ],
      action: { label: 'Open meeting attendance', icon: <Ticket size={15} />, onGo: onDoor },
    })
  }
  events.sort((a, b) => a.date.localeCompare(b.date))
  const next = events[0]

  return (
    <div
      className={cx(
        'text-white',
        standalone ? 'flex flex-col justify-center rounded-[18px] p-5' : 'mt-3 rounded-[14px] p-3',
        standalone && fill && 'h-full',
        short && 'shrink-0 gap-1.5 p-3.5',
        /* Kept to what the meeting actually needs, so the caseload above it
           gets the rest of the column. A scheduled meeting carries a line
           more, so there the height is a floor rather than a ceiling - it
           may run a few pixels over rather than clip the door button. */
        short && (next ? 'xl:min-h-[132px]' : 'xl:h-[132px]'),
      )}
      style={{ background: `linear-gradient(135deg, ${ROYAL} 0%, ${NAVY} 100%)` }}
    >
      {next ? (
        <>
          <div className="flex items-center justify-between rounded-full px-3.5 py-2 text-[11.5px] text-[#071539]" style={{ background: Y }}>
            <span>Upcoming event</span>
            <span className="font-semibold">{shortDate(next.date)}</span>
          </div>
          <div className={cx('flex items-start justify-between gap-2 px-1', short ? 'mt-1.5' : 'mt-2.5')}>
            <span className="min-w-0 text-[14px] leading-snug font-semibold text-balance">{next.title}</span>
            <span className="shrink-0 pt-0.5 text-[11px] text-white/70">{countdown(next.date)}</span>
          </div>
          {!short && (
            <dl className="mt-1.5 space-y-0.5 px-1 text-[11px]">
              {next.lines.map((ln) => (
                <div key={ln.label} className="flex gap-2">
                  <dt className="w-11 shrink-0 text-white/60">{ln.label}</dt>
                  <dd className="min-w-0 truncate text-white">{ln.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <button
            type="button"
            onClick={next.action.onGo}
            title={short ? next.lines.map((ln) => `${ln.label}: ${ln.value}`).join(' · ') : undefined}
            className={cx(
              'flex w-full items-center justify-between rounded-[16px] bg-white/12 px-3.5 text-[11.5px] font-medium transition-colors duration-100 hover:bg-white/20',
              short ? 'mt-1.5 py-2' : 'mt-3 py-2.5',
            )}
          >
            {next.action.label}
            {next.action.icon}
          </button>
          {events.length > 1 && !short && (
            <p className="mt-2 px-1 text-[10.5px] text-white/65">
              +{events.length - 1} more upcoming
            </p>
          )}
        </>
      ) : (
        <div className={cx('px-2', short ? 'py-0' : 'py-2')}>
          <div className="text-[11.5px] text-white/80">Upcoming event</div>
          <div className={cx('mt-1 font-medium', short ? 'text-[15px]' : 'text-[16px]')}>No scheduled events</div>
          <button
            type="button"
            onClick={onSet}
            className={cx(
              'w-full rounded-full py-2 text-[12px] font-semibold text-[#071539]',
              short ? 'mt-2' : 'mt-3',
            )}
            style={{ background: Y }}
          >
            {meeting ? 'Set the next meeting' : 'Set the parent meeting'}
          </button>
        </div>
      )}
    </div>
  )
}

/* --- Growth monitoring: the share off normal, weigh-in round by round ------
   One point per month that has a weigh-in on file. Each learner counts once
   in a month (their latest that month), classified against the WHO tables at
   the age they were THEN, so an old round is not re-banded at today's age.

   Two lines, like a this-week/last-week chart: the solid line is everyone off
   normal on either index, the dashed line is the wasted part of it. The
   figure in the header is the latest round, and the pill beside it is the
   change from the round before - a real difference between two weigh-ins on
   file, never a projection. With one round there is nothing to compare, and
   the card says so instead of drawing a line through a single point. */

export interface MeasurementRow {
  learnerId: string
  measuredOn: string
  heightCm: number
  weightKg: number
}

interface GrowthPoint {
  month: string
  weighed: number
  offNormal: number
  wasted: number
}

export function useMeasurementRows(learners: Learner[]): MeasurementRow[] {
  /* Shared and cached (lib/query.ts): read once, and again only after a save. */
  const rows = useQuery(SERVER_BACKED ? 'measurements' : null, endpoints.measurements).data?.measurements ?? null

  return useMemo(() => {
    if (SERVER_BACKED && rows) return rows
    /* The local build keeps one measurement per learner, so it has one round. */
    return learners
      .filter((l) => l.measuredOn && l.heightCm !== null && l.weightKg !== null)
      .map((l) => ({
        learnerId: l.id,
        measuredOn: l.measuredOn as string,
        heightCm: l.heightCm as number,
        weightKg: l.weightKg as number,
      }))
  }, [rows, learners])
}

function growthSeries(rows: MeasurementRow[], learners: Learner[]): GrowthPoint[] {
  const who = new Map(learners.map((l) => [l.id, l]))
  const latest = new Map<string, MeasurementRow>()
  for (const r of rows) {
    if (!who.has(r.learnerId)) continue
    const key = `${r.measuredOn.slice(0, 7)}|${r.learnerId}`
    const prev = latest.get(key)
    if (!prev || r.measuredOn > prev.measuredOn) latest.set(key, r)
  }
  const byMonth = new Map<string, GrowthPoint>()
  for (const [key, r] of latest) {
    const month = key.slice(0, 7)
    const l = who.get(r.learnerId) as Learner
    const a = assess(r.weightKg, r.heightCm, l.birthDate, r.measuredOn, l.sex)
    const p = byMonth.get(month) ?? { month, weighed: 0, offNormal: 0, wasted: 0 }
    p.weighed++
    if ((a.bmiBand && a.bmiBand !== 'Normal') || (a.hfaBand && a.hfaBand !== 'Normal')) p.offNormal++
    if (a.bmiBand === 'Wasted' || a.bmiBand === 'Severely Wasted') p.wasted++
    byMonth.set(month, p)
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
}

const monthName = (m: string, style: 'short' | 'long' = 'short') =>
  new Date(`${m}-01T00:00`).toLocaleDateString('en-US', { month: style, ...(style === 'long' ? { year: 'numeric' } : {}) })

/* "Aug '25". Rounds are a year or more apart as often as a month, so a
   month on its own (AUG, AUG, JAN, AUG) reads as nonsense on the axis. */
const roundLabel = (m: string) => `${monthName(m)} '${m.slice(2, 4)}`

export function GrowthCard({ learners }: { learners: Learner[] }) {
  const rows = useMeasurementRows(learners)
  const series = useMemo(() => growthSeries(rows, learners), [rows, learners])
  const areaFill = useGradientId('growth')

  const last = series.length - 1
  const share = (n: number, of: number) => pct(n, of)
  const prev = last > 0 ? series[last - 1] : null
  const delta = prev ? share(series[last].offNormal, series[last].weighed) - share(prev.offNormal, prev.weighed) : null

  /* One row per weigh-in round, in the shape the chart reads. */
  const data = series.map((p) => ({
    round: roundLabel(p.month),
    off: share(p.offNormal, p.weighed),
    wasted: share(p.wasted, p.weighed),
    weighed: p.weighed,
  }))
  const top = Math.max(20, Math.ceil((Math.max(0, ...data.map((d) => d.off)) + 5) / 10) * 10)

  return (
    <Card className="h-full">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <IconChip tone="navy">
            <ChartLine size={14} weight="fill" />
          </IconChip>
          <div className="min-w-0">
            <h3 className="truncate text-[14px] font-semibold tracking-[-0.01em] text-navy-900">Growth monitoring</h3>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="tnum font-display text-[22px] leading-none font-semibold text-navy-900">
                {series.length ? `${share(series[last].offNormal, series[last].weighed)}%` : '–'}
              </span>
              <span className="text-[11px] text-muted">need monitoring, {series.length ? monthName(series[last].month, 'long') : 'latest round'}</span>
              {delta !== null ? (
                <span
                  className={cx(
                    'tnum rounded-full px-2 py-0.5 text-[10.5px] font-semibold',
                    delta <= 0 ? 'bg-navy-50 text-navy-700' : 'bg-[#fdf0dc] text-[#a95f0f]',
                  )}
                  title={`Change from ${monthName(prev!.month, 'long')}`}
                >
                  {delta === 0 ? 'no change' : `${delta > 0 ? '▲ up' : '▼ down'} ${Math.abs(delta)} points`}
                </span>
              ) : (
                <span className="rounded-full bg-wash px-2 py-0.5 text-[10.5px] text-muted">
                  {series.length === 1 ? '1 weigh-in recorded' : 'no weigh-ins yet'}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 pt-1 text-[10.5px] text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-[3px] w-4 rounded-full" style={{ background: ROYAL }} />
            Needs monitoring
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 border-t-2 border-dashed" style={{ borderColor: ROYAL_SOFT }} />
            Wasted
          </span>
        </div>
      </div>

      {series.length === 0 ? (
        <p className="my-auto py-8 text-center text-[12px] text-muted">No measurements recorded.</p>
      ) : (
        <div className="relative mt-3" role="img" aria-label="Share of learners who need monitoring, per weigh-in round">
          <ResponsiveContainer width="100%" height={150}>
            <AreaChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={areaFill} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={ROYAL} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={ROYAL} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis
                dataKey="round"
                axisLine={false}
                tickLine={false}
                tick={AXIS_TICK}
                padding={data.length === 1 ? { left: 40, right: 40 } : { left: 12, right: 12 }}
              />
              <YAxis
                width={38}
                axisLine={false}
                tickLine={false}
                tick={AXIS_TICK}
                domain={[0, top]}
                ticks={[0, top / 2, top]}
                tickFormatter={(v: number) => `${v}%`}
              />
              <Tooltip
                cursor={{ stroke: ROYAL, strokeOpacity: 0.25, strokeDasharray: '3 3' }}
                content={({ active, payload }) => {
                  const p = active && payload?.[0] ? (payload[0].payload as (typeof data)[number]) : null
                  return p ? (
                    <ChartTip title={`${p.off}% need monitoring`}>
                      <div>{p.wasted}% wasted</div>
                      <div>
                        {p.round} · {p.weighed} weighed
                      </div>
                    </ChartTip>
                  ) : null
                }}
              />
              <Area
                type="monotone"
                dataKey="off"
                stroke={ROYAL}
                strokeWidth={3}
                fill={`url(#${areaFill})`}
                dot={{ r: 3.5, fill: '#fff', stroke: ROYAL, strokeWidth: 2 }}
                activeDot={{ r: 5, fill: ROYAL, stroke: '#fff', strokeWidth: 2 }}
              />
              <Area
                type="monotone"
                dataKey="wasted"
                stroke={ROYAL_SOFT}
                strokeWidth={2}
                strokeDasharray="5 5"
                fill="none"
                dot={{ r: 3, fill: '#fff', stroke: ROYAL_SOFT, strokeWidth: 2, strokeDasharray: '0' }}
                activeDot={{ r: 3.5, fill: '#fff', stroke: ROYAL_SOFT, strokeWidth: 2, strokeDasharray: '0' }}
              />
            </AreaChart>
          </ResponsiveContainer>
          {series.length === 1 && (
            <p className="-mt-1 text-center text-[10.5px] text-muted">The trend line requires a second weigh-in round.</p>
          )}
        </div>
      )}
    </Card>
  )
}

/* --- Classification: the WHO bands, one bar per band ----------------------
   The share of the learners weighed so far in each band, on one index at a
   time - BMI-for-age (wasted through obese) or height-for-age (stunted
   through tall) - switched by the pills in the corner. The most common band
   off Normal is picked by default: the problem this roster has most of. */

/* Written out, never abbreviated: "Sev. W" is a code the nurse has to
   decode. The label wraps to two lines under its bar instead. */
const SHORT_BAND: Record<string, string> = {
  'Severely Wasted': 'Severely wasted',
  'Severely Stunted': 'Severely stunted',
}

export function ClassificationCard({
  learners,
  healthy,
  needsMonitoring,
}: {
  learners: Learner[]
  healthy: number
  needsMonitoring: number
}) {
  const [index, setIndex] = useState<'bmi' | 'hfa'>('bmi')
  const measured = learners.filter((l) => l.measuredOn)
  const bands = (index === 'bmi' ? BMI_BANDS : HFA_BANDS) as readonly string[]
  const rows = bands.map((b) => {
    const n = measured.filter((l) => (index === 'bmi' ? l.bmiBand : l.hfaBand) === b).length
    return { band: b, n, share: pct(n, measured.length) }
  })
  const worst = [...rows].filter((r) => r.band !== 'Normal' && r.n > 0).sort((a, b) => b.n - a.n)[0]

  /* A donut since 2026-10-10 (the user's choice over the bars): the bands of
     one index always add up to the learners weighed, so the whole ring is
     the class and each slice a band. The centre names one band - the most
     common one off Normal at rest, the hovered one otherwise. */
  const [hovered, setHovered] = useState<string | null>(null)
  const centre = rows.find((r) => r.band === hovered) ?? worst ?? rows.find((r) => r.band === 'Normal')
  const slices = rows.filter((r) => r.n > 0)
  const color = (b: string) => BAND_COLOR[b as keyof typeof BAND_COLOR]

  return (
    <Card className="h-full gap-4 lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[11.5px] font-medium text-muted">Classification</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="tnum font-display text-[30px] leading-none font-semibold tracking-[-0.03em] text-navy-900">
                {measured.length}
              </span>
              <span className="text-[11.5px] text-muted">weighed</span>
            </div>
          </div>
          <div className="flex items-center gap-0.5 rounded-full bg-wash p-0.5">
            {(
              [
                ['bmi', 'BMI'],
                ['hfa', 'Height'],
              ] as const
            ).map(([k, text]) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setIndex(k)
                  setHovered(null)
                }}
                aria-pressed={index === k}
                className={cx(
                  'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors duration-100',
                  index === k ? 'bg-navy-800 text-white' : 'text-muted hover:text-navy-900',
                )}
              >
                {text}
              </button>
            ))}
          </div>
        </div>

        {measured.length === 0 ? (
          <p className="my-auto py-6 text-center text-[12px] text-muted">No measurements recorded.</p>
        ) : (
          <div className="mt-auto flex items-center gap-4 pt-3" onMouseLeave={() => setHovered(null)}>
            <div
              className="relative size-[132px] shrink-0"
              role="img"
              aria-label={`${index === 'bmi' ? 'BMI-for-age' : 'Height-for-age'}: ${rows.map((r) => `${r.band} ${r.n}`).join(', ')}`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={slices}
                    dataKey="n"
                    nameKey="band"
                    innerRadius={44}
                    outerRadius={64}
                    startAngle={90}
                    endAngle={-270}
                    paddingAngle={slices.length > 1 ? 2.5 : 0}
                    cornerRadius={4}
                    stroke="none"
                    onMouseEnter={(_: unknown, i: number) => setHovered(slices[i]?.band ?? null)}
                  >
                    {slices.map((r) => (
                      <Cell
                        key={r.band}
                        fill={color(r.band)}
                        cursor="pointer"
                        opacity={centre && centre.band !== r.band ? 0.38 : 1}
                      />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              {centre && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                  <div>
                    <div className="tnum font-display text-[22px] leading-none font-semibold text-navy-900">{centre.share}%</div>
                    <div className="mx-auto mt-1 max-w-[76px] text-[10px] leading-tight text-muted">
                      {SHORT_BAND[centre.band] ?? centre.band}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <ul className="min-w-0 flex-1 space-y-0.5">
              {rows.map((r) => (
                <li key={r.band}>
                  <button
                    type="button"
                    onMouseEnter={() => setHovered(r.band)}
                    onFocus={() => setHovered(r.band)}
                    className={cx(
                      'flex w-full items-center gap-2 rounded-[8px] px-1.5 py-1 text-left text-[11.5px] transition-colors duration-100',
                      centre?.band === r.band ? 'bg-wash' : 'hover:bg-wash',
                    )}
                  >
                    <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: color(r.band) }} />
                    <span className="min-w-0 flex-1 truncate text-navy-900">{SHORT_BAND[r.band] ?? r.band}</span>
                    <span className="tnum font-semibold text-navy-900">{r.n}</span>
                    <span className="tnum w-8 text-right text-[10.5px] text-muted">{r.share}%</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <StatusSplit healthy={healthy} needsMonitoring={needsMonitoring} measured={measured.length} />
    </Card>
  )
}

/* --- The semicircle, for any few-part whole -------------------------------- */

export interface GaugeSegment {
  label: string
  n: number
  color: string
}

export function GaugeCard({
  icon,
  tone,
  title,
  eyebrow,
  segments,
  centerValue,
  centerLabel,
  footnote,
  onGo,
  goLabel,
}: {
  icon: ReactNode
  tone: Tone
  title: string
  eyebrow: string
  segments: GaugeSegment[]
  centerValue: string
  centerLabel: string
  footnote?: ReactNode
  onGo?: () => void
  goLabel?: string
}) {
  const total = segments.reduce((a, s) => a + s.n, 0)
  const shown = segments.filter((sg) => sg.n > 0)

  return (
    <Card className="h-full">
      <CardHead icon={icon} tone={tone} eyebrow={eyebrow} title={title} onGo={onGo} goLabel={goLabel} />
      <div className="relative mx-auto mt-2 h-[100px] w-full max-w-[190px]" role="img" aria-label={title}>
        {/* A half doughnut in Recharts: the wash track underneath, the
            segments on top with rounded ends and a small gap between. */}
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <Pie
              data={[{ n: 1 }]}
              dataKey="n"
              cx="50%"
              cy="100%"
              startAngle={180}
              endAngle={0}
              innerRadius={62}
              outerRadius={92}
              fill="var(--color-wash)"
              stroke="none"
              isAnimationActive={false}
            />
            <Pie
              data={total ? shown : []}
              dataKey="n"
              nameKey="label"
              cx="50%"
              cy="100%"
              startAngle={180}
              endAngle={0}
              innerRadius={62}
              outerRadius={92}
              paddingAngle={shown.length > 1 ? 2 : 0}
              cornerRadius={5}
              stroke="none"
            >
              {shown.map((sg) => (
                <Cell key={sg.label} fill={sg.color} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                const p = active && payload?.[0] ? (payload[0].payload as GaugeSegment) : null
                return p ? <ChartTip title={`${p.label}: ${p.n}`}>{pct(p.n, total)}% of {total}</ChartTip> : null
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-x-0 bottom-0 text-center">
          <div className="tnum font-display text-[24px] leading-none font-semibold text-navy-900">{centerValue}</div>
          <div className="mt-0.5 text-[10.5px] text-muted">{centerLabel}</div>
        </div>
      </div>
      <ul className="mt-2.5 space-y-1">
        {segments.map((sg) => (
          <li key={sg.label} className="flex items-center gap-2.5 text-[12px] text-navy-900">
            <span className="size-3 rounded-[4px]" style={{ background: sg.color }} />
            <span className="flex-1">{sg.label}</span>
            <span className="tnum font-semibold">{sg.n}</span>
          </li>
        ))}
      </ul>
      {footnote && <p className="mt-auto truncate pt-2.5 text-[11px] text-muted">{footnote}</p>}
    </Card>
  )
}

/* --- Weighed so far, as the semicircle -------------------------------------
   Weighed, marked absent on the day, and not yet reached. The grade with the
   most still to weigh is named under the legend - the classroom to walk to. */

export function WeighedCard({
  learners,
  absentIds,
  onGo,
}: {
  learners: Learner[]
  absentIds: Set<string>
  onGo: () => void
}) {
  const weighed = learners.filter((l) => l.measuredOn).length
  const absent = learners.filter((l) => !l.measuredOn && absentIds.has(l.id)).length
  const left = learners.length - weighed - absent

  const byGrade = new Map<number, number>()
  for (const l of learners) if (!l.measuredOn) byGrade.set(l.gradeLevel, (byGrade.get(l.gradeLevel) ?? 0) + 1)
  const behind = [...byGrade.entries()].sort((a, b) => b[1] - a[1])[0]

  return (
    <GaugeCard
      icon={<Scales size={14} weight="fill" />}
      tone="blue"
      title="Weighed so far"
      eyebrow="All learners"
      segments={[
        { label: 'Weighed', n: weighed, color: ROYAL },
        { label: 'Absent', n: absent, color: 'var(--color-gold-500)' },
        { label: 'Not yet weighed', n: left, color: MIST },
      ]}
      centerValue={`${pct(weighed, learners.length)}%`}
      centerLabel="weighed"
      footnote={
        behind ? (
          <>
            Most left in <span className="font-semibold text-navy-900">Grade {behind[0]}</span> &middot; {behind[1]}
          </>
        ) : (
          'All learners weighed'
        )
      }
      onGo={onGo}
      goLabel="Weigh-in"
    />
  )
}

/* --- Priority cases: the nurse's clinical caseload -------------------------
   Not every flagged child - the ones she sees first. A child is a priority
   case when a band is SEVERE (severely wasted, severely stunted, obese), or
   when they carry two problems at once (wasted AND stunted). Everyone else
   who is flagged is followed up on the slips and attendance screens.

   Worst first: severe bands before moderate, two problems before one, then
   the furthest z-score from zero. The z-score is printed on each condition,
   because "severely stunted" at -3.1 and at -4.6 are not the same child. */

const SEVERE_BANDS = new Set(['Severely Wasted', 'Severely Stunted', 'Obese'])

export function isPriority(l: Learner): boolean {
  if (!isFlagged(l)) return false
  const wasted = l.bmiBand === 'Wasted' || l.bmiBand === 'Severely Wasted'
  const stunted = l.hfaBand === 'Stunted' || l.hfaBand === 'Severely Stunted'
  return SEVERE_BANDS.has(l.bmiBand ?? '') || SEVERE_BANDS.has(l.hfaBand ?? '') || (wasted && stunted)
}

/** The conditions a priority case is filed under, for the filter pills. */
function conditionsOf(l: Learner): string[] {
  const out: string[] = []
  if (l.bmiBand === 'Severely Wasted') out.push('Severely Wasted')
  if (l.hfaBand === 'Severely Stunted') out.push('Severely Stunted')
  if (l.bmiBand === 'Obese') out.push('Obese')
  const wasted = l.bmiBand === 'Wasted' || l.bmiBand === 'Severely Wasted'
  const stunted = l.hfaBand === 'Stunted' || l.hfaBand === 'Severely Stunted'
  if (wasted && stunted) out.push('Wasted + stunted')
  return out
}

function priorityRank(l: Learner): number {
  const severe = [l.bmiBand, l.hfaBand].filter((b) => SEVERE_BANDS.has(b ?? '')).length
  const both = conditionsOf(l).includes('Wasted + stunted') ? 1 : 0
  const z = Math.max(Math.abs(l.bmiZ ?? 0), Math.abs(l.hfaZ ?? 0))
  return severe * 100 + both * 50 + z
}

export function PriorityRail({
  learners,
  onOpen,
}: {
  learners: Learner[]
  onOpen: (l: Learner) => void
}) {
  const cases = learners.filter(isPriority)
  const count = (k: string) => cases.filter((l) => conditionsOf(l).includes(k)).length
  const all: RailTab[] = [
    { key: 'all', label: 'All', count: cases.length, test: () => true },
    { key: 'Severely Wasted', label: 'Severely wasted', count: count('Severely Wasted'), test: (l) => conditionsOf(l).includes('Severely Wasted') },
    { key: 'Severely Stunted', label: 'Severely stunted', count: count('Severely Stunted'), test: (l) => conditionsOf(l).includes('Severely Stunted') },
    { key: 'Obese', label: 'Obese', count: count('Obese'), test: (l) => conditionsOf(l).includes('Obese') },
    { key: 'Wasted + stunted', label: 'Wasted and stunted', count: count('Wasted + stunted'), test: (l) => conditionsOf(l).includes('Wasted + stunted') },
  ]
  const tabs = all.filter((t) => t.key === 'all' || (t.count ?? 0) > 0)

  return (
    <LearnerRail
      icon={<Siren size={14} weight="fill" />}
      tone="red"
      title="Priority cases"
      subtitle="Severe cases, or wasted and stunted"
      learners={cases}
      tabs={tabs}
      sort={(a, b) => priorityRank(b) - priorityRank(a) || a.lastName.localeCompare(b.lastName)}
      meta={(l) => (
        <>
          {l.section} &middot; <BandText l={l} />
        </>
      )}
      badge={(l) => <FollowPill l={l} />}
      onOpen={onOpen}
    />
  )
}
