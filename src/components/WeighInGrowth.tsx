import { useMemo } from 'react'
import type { Learner } from '@/data/mock'
import { useMeasurementRows } from './bento'
import type { EChartsCoreOption } from 'echarts/core'
import { EChart, echarts } from './EChart'
import { BAND_COLOR, BMI_CUTOFFS, HFA_CUTOFFS, ageInMonths, assess, type BmiBand, type HfaBand } from '@/lib/nutrition'
import { formatDate } from '@/lib/dates'

/* The growth panel under the weigh-in form.

   The reading being typed is placed on the learner's own trend BEFORE it is
   saved, so a mistyped digit or a real change in status is seen in context -
   "z −2.4, down from −1.7 a year ago" reads very differently from "z −2.4"
   alone.

   Three panes in one container (2026-10-12, the user's request, replacing
   one chart with tabs): BMI-for-age, height-for-age and weight, each with
   the latest figure, its band, the change since the measurement before and a
   compact trend. Every index is in view at once, so nothing hides behind a
   tab while the child is still on the scale. The panes share one border and
   are split by hairlines rather than gaps, and the trends are drawn with
   Apache ECharts (./EChart.tsx), both also at the user's request. */

export interface PendingReading {
  heightCm: number
  weightKg: number
  /** The date the reading will be saved with. A correction replaces the
      saved measurement on this date, so that one is left off the chart. */
  on: string
}

interface Point {
  on: string
  /** Age in months on the day of the measurement. */
  age: number
  height: number
  weight: number
  bmiZ: number | null
  hfaZ: number | null
  bmiBand: BmiBand | null
  hfaBand: HfaBand | null
  pending: boolean
}

type Metric = 'bmi' | 'hfa' | 'weight'

const round1 = (n: number) => Math.round(n * 10) / 10
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}`
const ageLabel = (m: number) => {
  const months = Math.round(m)
  return `${Math.floor(months / 12)} y ${months % 12} m`
}
const shortDate = (iso: string) =>
  new Date(`${iso}T00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

/** Every measurement of this learner, oldest first, with the unsaved reading last. */
export function useGrowthPoints(l: Learner, pending: PendingReading | null): Point[] {
  const all = useMeasurementRows(useMemo(() => [l], [l]))
  return useMemo(() => {
    const byDate = new Map<string, { on: string; heightCm: number; weightKg: number }>()
    for (const r of all) {
      if (r.learnerId === l.id) byDate.set(r.measuredOn, { on: r.measuredOn, heightCm: r.heightCm, weightKg: r.weightKg })
    }
    /* The local build keeps one measurement per learner; the one before it
       rides along as `previous`. */
    if (l.previous && !byDate.has(l.previous.measuredOn)) {
      byDate.set(l.previous.measuredOn, { on: l.previous.measuredOn, heightCm: l.previous.heightCm, weightKg: l.previous.weightKg })
    }
    if (pending) byDate.delete(pending.on)
    const rows = [...byDate.values()].sort((a, b) => a.on.localeCompare(b.on))
    const toPoint = (on: string, heightCm: number, weightKg: number, isPending: boolean): Point => {
      const a = assess(weightKg, heightCm, l.birthDate, on, l.sex)
      return {
        on,
        age: ageInMonths(l.birthDate, on),
        height: heightCm,
        weight: weightKg,
        bmiZ: a.bmiZ === null ? null : round1(a.bmiZ),
        hfaZ: a.hfaZ === null ? null : round1(a.hfaZ),
        bmiBand: a.bmiBand,
        hfaBand: a.hfaBand,
        pending: isPending,
      }
    }
    const points = rows.map((r) => toPoint(r.on, r.heightCm, r.weightKg, false))
    if (pending) points.push(toPoint(pending.on, pending.heightCm, pending.weightKg, true))
    return points
  }, [all, l, pending])
}

/* --- The panel: three cards, one per index -------------------------------- */

const ROYAL = '#2b52c4'

interface CardSpec {
  key: Metric
  title: string
  /** The plotted value: a z-score for the two indices, kilograms for weight. */
  value: (p: Point) => number | null
  band: (p: Point) => BmiBand | HfaBand | null
  headline: (p: Point) => string
  sub: (p: Point) => string
  /** The change from the measurement before, and how to colour it. */
  delta: (a: Point, b: Point) => { text: string; tone: 'good' | 'bad' | 'plain' } | null
}

/** A z-score that moved toward 0 is good news, away from it is not. */
function zDelta(a: number | null, b: number | null): { text: string; tone: 'good' | 'bad' | 'plain' } | null {
  if (a === null || b === null) return null
  const tone = Math.abs(b) < Math.abs(a) - 0.2 ? 'good' : Math.abs(b) > Math.abs(a) + 0.2 ? 'bad' : 'plain'
  return { text: `${signed(round1(b - a))} z`, tone }
}

const CARDS: CardSpec[] = [
  {
    key: 'bmi',
    title: 'BMI-for-age',
    value: (p) => p.bmiZ,
    band: (p) => p.bmiBand,
    headline: (p) => (p.bmiZ === null ? '–' : `z ${signed(p.bmiZ)}`),
    sub: (p) => `BMI ${(p.weight / (p.height / 100) ** 2).toFixed(1)}`,
    delta: (a, b) => zDelta(a.bmiZ, b.bmiZ),
  },
  {
    key: 'hfa',
    title: 'Height-for-age',
    value: (p) => p.hfaZ,
    band: (p) => p.hfaBand,
    headline: (p) => (p.hfaZ === null ? '–' : `z ${signed(p.hfaZ)}`),
    sub: (p) => `${p.height.toFixed(1)} cm`,
    delta: (a, b) => ({ text: `${signed(b.height - a.height)} cm`, tone: 'plain' }),
  },
  {
    key: 'weight',
    title: 'Weight',
    value: (p) => p.weight,
    band: () => null,
    headline: (p) => `${p.weight.toFixed(1)} kg`,
    sub: () => '',
    delta: (a, b) => ({ text: `${signed(b.weight - a.weight)} kg`, tone: 'plain' }),
  },
]

export function GrowthPanel({ learner, pending }: { learner: Learner; pending: PendingReading | null }) {
  const points = useGrowthPoints(learner, pending)
  const hasPending = points.some((p) => p.pending)

  return (
    <section className="panel flex min-h-0 flex-1 flex-col rounded-[20px] px-5 pt-4 pb-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold tracking-[-0.01em] text-navy-900">Growth</h3>
        <div className="flex items-center gap-3 text-[11px] text-muted">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: ROYAL }} />
            Saved
          </span>
          {hasPending && (
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-[#ffde17] shadow-[0_0_0_1.5px_#0e2464]" />
              Today, not saved
            </span>
          )}
        </div>
      </div>

      {/* One container, three panes split by hairlines. */}
      <div className="mt-3 grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-[16px] bg-white shadow-[inset_0_0_0_1px_var(--color-line)] md:grid-cols-3">
        {CARDS.map((c, i) => (
          <GrowthPane key={c.key} spec={c} points={points} first={i === 0} />
        ))}
      </div>
    </section>
  )
}

/* --- One pane ------------------------------------------------------------- */

const TONE = { good: 'var(--color-n)', bad: 'var(--color-w)', plain: 'var(--color-muted)' } as const

function GrowthPane({ spec, points, first }: { spec: CardSpec; points: Point[]; first: boolean }) {
  const last = points[points.length - 1]
  const before = points[points.length - 2]
  const band = last ? spec.band(last) : null
  const delta = last && before ? spec.delta(before, last) : null
  const plotted = points.filter((p) => spec.value(p) !== null)
  const when = (p: Point) => (p.pending ? 'Today' : shortDate(p.on))

  return (
    <article
      className={
        'flex min-h-[176px] min-w-0 flex-col px-4 pt-3.5 pb-3' +
        (first ? '' : ' border-t border-line md:border-t-0 md:border-l')
      }
    >
      <header className="flex items-center justify-between gap-2">
        <span className="truncate text-[11.5px] font-semibold text-muted">{spec.title}</span>
        {band && (
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
            style={{ color: BAND_COLOR[band], background: `color-mix(in srgb, ${BAND_COLOR[band]} 11%, white)` }}
          >
            {band}
          </span>
        )}
      </header>

      <div className="mt-1 flex items-baseline gap-2">
        <span className="tnum font-display text-[22px] leading-tight font-semibold tracking-[-0.02em] text-navy-900">
          {last ? spec.headline(last) : '–'}
        </span>
        {last && spec.sub(last) && <span className="tnum truncate text-[11px] text-muted">{spec.sub(last)}</span>}
      </div>

      <div className="tnum mt-0.5 truncate text-[11px]">
        {delta && before ? (
          <>
            <span className="font-semibold" style={{ color: TONE[delta.tone] }}>
              {delta.text}
            </span>
            <span className="text-muted"> since {shortDate(before.on)}</span>
          </>
        ) : (
          <span className="text-muted">{last ? 'First measurement' : 'No measurement yet'}</span>
        )}
      </div>

      <div className="relative mt-2 min-h-[72px] flex-1">
        {plotted.length > 0 && <Trend points={plotted} spec={spec} />}
      </div>

      {plotted.length > 0 && (
        <div className="tnum mt-1 flex justify-between text-[10px] text-placeholder">
          <span>{when(plotted[0])}</span>
          {plotted.length > 1 && <span>{when(plotted[plotted.length - 1])}</span>}
        </div>
      )}
    </article>
  )
}

/* --- The trend inside a pane ----------------------------------------------
   A trend, not a plotting grid: no axes, a smooth line with a soft shadow
   over a gradient fill, the normal range as a faint band for the two
   indices, and today's unsaved reading as a pulsing yellow point at the end
   of a dotted step. Exact figures are on hover. */

const NAVY = '#0e2464'

function Trend({ points, spec }: { points: Point[]; spec: CardSpec }) {
  const option = useMemo<EChartsCoreOption>(() => {
    const isZ = spec.key !== 'weight'
    const v = (p: Point) => spec.value(p) as number
    const saved = points.filter((p) => !p.pending)
    const pending = points.find((p) => p.pending)
    const lastSaved = saved[saved.length - 1]

    const vals = points.map(v)
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const room = Math.max(2, (max - min) * 0.3)
    const lo = isZ ? Math.min(-3, Math.floor(min - 0.5)) : Math.floor(min - room)
    const hi = isZ ? Math.max(3, Math.ceil(max + 0.5)) : Math.ceil(max + room)
    const ages = points.map((p) => p.age)
    const pad = ages.length === 1 ? 6 : Math.max(1, (Math.max(...ages) - Math.min(...ages)) * 0.06)
    /* The normal range, from the same tables that classify the learner - so
       the band on the chart and the chip on the pane agree. */
    const normal = !isZ ? undefined : (spec.key === 'bmi' ? BMI_CUTOFFS : HFA_CUTOFFS).find((c) => c.band === 'Normal')
    const fmt = (n: number) => (isZ ? `z ${signed(n)}` : `${n.toFixed(1)} kg`)
    const item = (p: Point) => ({ value: [p.age, v(p)], point: p })

    return {
      animationDuration: 700,
      animationEasing: 'cubicOut',
      grid: { left: 10, right: 14, top: 14, bottom: 6 },
      xAxis: { type: 'value', show: false, min: Math.min(...ages) - pad, max: Math.max(...ages) + pad },
      yAxis: { type: 'value', show: false, min: lo, max: hi },
      tooltip: {
        trigger: 'item',
        backgroundColor: NAVY,
        borderWidth: 0,
        padding: [8, 12],
        extraCssText: 'border-radius:10px;box-shadow:0 10px 24px -10px rgba(4,12,36,0.6);',
        textStyle: { color: '#fff', fontSize: 12 },
        formatter: (params: { data?: { point?: Point } }) => {
          const p = params.data?.point
          if (!p) return ''
          const b = spec.band(p)
          return (
            `<div style="font-weight:600">${fmt(v(p))}${b ? ` · ${b}` : ''}</div>` +
            `<div style="margin-top:2px;font-size:10.5px;color:#b9c6ea">${p.pending ? 'Today, not saved' : formatDate(p.on)} · ${ageLabel(p.age)}</div>` +
            `<div style="font-size:10.5px;color:#b9c6ea">${p.height.toFixed(1)} cm · ${p.weight.toFixed(1)} kg</div>`
          )
        },
      },
      series: [
        {
          type: 'line',
          data: saved.map(item),
          smooth: 0.4,
          symbol: 'circle',
          symbolSize: 8,
          showSymbol: true,
          lineStyle: {
            width: 3,
            cap: 'round',
            color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
              { offset: 0, color: '#7f9be6' },
              { offset: 1, color: ROYAL },
            ]),
            shadowColor: 'rgba(43,82,196,0.28)',
            shadowBlur: 10,
            shadowOffsetY: 5,
          },
          itemStyle: { color: '#fff', borderColor: ROYAL, borderWidth: 2.5 },
          emphasis: { scale: 1.4, itemStyle: { color: ROYAL, borderColor: '#fff' } },
          areaStyle: {
            origin: 'start',
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(43,82,196,0.22)' },
              { offset: 1, color: 'rgba(43,82,196,0)' },
            ]),
          },
          markArea: normal
            ? {
                silent: true,
                itemStyle: { color: 'rgba(19,108,52,0.055)' },
                data: [[{ yAxis: Math.max(normal.min, lo) }, { yAxis: Math.min(normal.max, hi) }]],
              }
            : undefined,
          markLine: isZ
            ? {
                silent: true,
                symbol: 'none',
                label: { show: false },
                lineStyle: { color: 'rgba(19,108,52,0.3)', type: [3, 4], width: 1 },
                data: [{ yAxis: 0 }],
              }
            : undefined,
          z: 3,
        },
        /* The dotted step from the last saved point to today's. */
        ...(pending && lastSaved
          ? [
              {
                type: 'line',
                data: [item(lastSaved), item(pending)],
                symbol: 'none',
                silent: true,
                tooltip: { show: false },
                lineStyle: { color: ROYAL, width: 2, type: [1, 6], cap: 'round', opacity: 0.6 },
                z: 2,
              },
            ]
          : []),
        ...(pending
          ? [
              {
                type: 'effectScatter',
                data: [item(pending)],
                symbolSize: 11,
                rippleEffect: { scale: 2.8, brushType: 'fill', period: 2.6, color: 'rgba(255,222,23,0.55)' },
                itemStyle: { color: '#ffde17', borderColor: NAVY, borderWidth: 2 },
                z: 5,
              },
            ]
          : []),
      ],
    }
  }, [points, spec])

  return <EChart option={option} className="absolute inset-0" />
}

