import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { cx } from './ui'
import { formatDate } from '../lib/dates'

/* One measure over time, for one child.

   SMALL MULTIPLES, NOT ONE CHART WITH FOUR LINES. Height is around 120cm,
   weight around 25kg and a z-score around zero. Drawing them together needs
   either a second y-axis - which makes two lines cross wherever the author
   chose to put the scales, and is the single most misleading thing a chart can
   do - or a normalisation that throws away the units a nurse actually reads.
   One panel each, one scale each, sharing an x.

   DRAWN AT REAL PIXELS, NOT SCALED. The first version used a fixed viewBox and
   let the browser stretch it, which is right at one size and wrong at every
   other: an 8px axis label rendered at 18px in a wide panel and at 6px in a
   narrow one, and the axes could only afford a first-and-last date. The panel
   measures itself and the chart is drawn to that width, so a tick label is the
   size it says it is at every width and the axes carry real ticks.

   ONE HUE. Each panel holds a single series and its own title names it, so
   colour carries nothing here and a four-colour set would be decoration
   competing with the clinical palette. That palette is reserved: Severely
   Wasted red and Normal green mean a band on this screen, and a weight line
   borrowing green would be saying something it does not mean. The only place
   the band colours appear is behind the z-score panel, where they ARE the
   bands.

   THE HOVER IS SHARED. Panels take the same hovered index from their parent,
   so pointing at one reads them all for that date - which is the question
   ("what was this child on that day") that a set of small multiples otherwise
   makes you answer once per panel.
-------------------------------------------------------------------------- */

export interface GrowthPoint {
  date: string
  value: number | null
}

/** A WHO band drawn behind the z-score panel, in the band's own colour. */
export interface ZBand {
  from: number
  to: number
  color: string
  label: string
}

/** The panel's width, measured. A chart that guesses its own width draws
    everything else at the wrong size. */
function useWidth() {
  const ref = useRef<HTMLDivElement | null>(null)
  const [w, setW] = useState(0)

  useLayoutEffect(() => {
    if (ref.current) setW(ref.current.clientWidth)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0
      if (next > 0) setW(next)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return [ref, w] as const
}

/* Ticks a person would have chosen: steps of 1, 2, 2.5 or 5 times a power of
   ten, landing on round numbers. The alternative - cutting the range into
   four - puts labels on 14.63 and 15.27, which nobody reads off an axis. */
function niceTicks(lo: number, hi: number, want: number): number[] {
  const span = hi - lo
  if (!(span > 0)) return [lo]
  const raw = span / want
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag
  const out: number[] = []
  for (let t = Math.ceil(lo / step) * step; t <= hi + step / 1000; t += step) {
    out.push(Number(t.toFixed(6)))
  }
  return out
}

function bounds(values: number[], bands?: ZBand[]) {
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  if (bands) {
    /* The z panel is read against the cut-offs, so -2 and +2 stay in view even
       for a child who has never been near them. A z-score chart cropped to a
       flat line at +0.3 says nothing about how far from a flag that is. */
    lo = Math.min(lo, -3)
    hi = Math.max(hi, 3)
  }
  if (lo === hi) {
    lo -= 1
    hi += 1
  }
  const pad = (hi - lo) * 0.12
  return { lo: lo - pad, hi: hi + pad }
}

/** "2025-08-04" as "Aug '25", which is what an axis has room for. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function axisDate(iso: string) {
  const [y, m] = iso.split('-')
  return `${MONTHS[Number(m) - 1] ?? m} '${y.slice(2)}`
}

export function GrowthChart({
  title,
  unit,
  points,
  decimals = 1,
  bands,
  hover,
  onHover,
  height = 208,
  compact,
}: {
  title: string
  unit?: string
  points: GrowthPoint[]
  decimals?: number
  bands?: ZBand[]
  hover: number | null
  onHover: (i: number | null) => void
  /** Drawing height in real pixels. */
  height?: number
  /** Tighter frame and type, for the weigh-in station's rail. */
  compact?: boolean
}) {
  const clip = useId()
  const [box, W] = useWidth()
  const real = points.filter((p) => p.value !== null) as { date: string; value: number }[]
  const last = real[real.length - 1]

  const H = height
  const PAD = compact
    ? { top: 10, right: 12, bottom: 20, left: 32 }
    : { top: 16, right: 18, bottom: 30, left: 44 }
  const PW = Math.max(0, W - PAD.left - PAD.right)
  const PH = H - PAD.top - PAD.bottom

  function body() {
    if (real.length === 0) {
      return <p className="px-3 py-8 text-center text-[11.5px] text-muted">No measurements recorded.</p>
    }

    /* One reading is a fact, not a trend. A "line" through a single point is a
       dot with an axis drawn round it pretending to be a chart. */
    if (real.length === 1) {
      return (
        <div className="px-3.5 py-6 text-center">
          <div className="tnum font-display text-[26px] leading-none font-bold text-navy-900">
            {real[0].value.toFixed(decimals)}
            {unit && <span className="ml-1 text-[12px] font-medium text-muted">{unit}</span>}
          </div>
          <p className="mt-1.5 text-[10.5px] text-muted">{formatDate(real[0].date)}</p>
          <p className="mt-2 text-[10.5px] text-placeholder">
            At least two measurements are required to display a chart.
          </p>
        </div>
      )
    }

    /* Nothing can be laid out until the panel has said how wide it is. */
    if (W === 0) return <div style={{ height: H }} />

    const { lo, hi } = bounds(
      real.map((p) => p.value),
      bands,
    )
    const x = (i: number) => PAD.left + (i / (points.length - 1)) * PW
    const y = (v: number) => PAD.top + PH - ((v - lo) / (hi - lo)) * PH

    /* Gaps are breaks, not straight lines through them. A weigh-in the child
       was absent for is a missing reading, and joining across it would draw a
       measurement nobody took. */
    const segments: { i: number; v: number }[][] = []
    let run: { i: number; v: number }[] = []
    points.forEach((p, i) => {
      if (p.value === null) {
        if (run.length) segments.push(run)
        run = []
      } else run.push({ i, v: p.value })
    })
    if (run.length) segments.push(run)

    const yTicks = niceTicks(lo, hi, compact ? 3 : 4)

    /* Label as many dates as fit without touching. The alternative that keeps
       every label - rotating them - buys a row of diagonal text that is harder
       to read than four upright ones. */
    const roomFor = Math.max(1, Math.floor(PW / (compact ? 52 : 66)))
    const every = Math.max(1, Math.ceil((points.length - 1) / roomFor))
    const xTicks = points.map((_, i) => i).filter((i) => i % every === 0 || i === points.length - 1)

    const hovered = hover !== null && points[hover]?.value != null ? points[hover] : null

    return (
      <div className="relative">
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="block"
          role="img"
          aria-label={`${title} over time, ${real.length} readings, latest ${last.value.toFixed(decimals)}${unit ?? ''}`}
          onPointerLeave={() => onHover(null)}
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const px = ((e.clientX - rect.left) / rect.width) * W
            const i = Math.round(((px - PAD.left) / PW) * (points.length - 1))
            onHover(Math.max(0, Math.min(points.length - 1, i)))
          }}
        >
          <defs>
            <clipPath id={clip}>
              <rect x={PAD.left} y={PAD.top} width={PW} height={PH} />
            </clipPath>
          </defs>

          {/* The WHO cut-offs, behind everything, at the strength of a ground
              rather than a mark. */}
          {bands?.map((b) => {
            const top = y(Math.min(b.to, hi))
            const bottom = y(Math.max(b.from, lo))
            if (bottom <= top) return null
            return (
              <rect
                key={b.label}
                x={PAD.left}
                y={top}
                width={PW}
                height={bottom - top}
                fill={b.color}
                opacity={0.08}
                clipPath={`url(#${clip})`}
              />
            )
          })}

          {/* Recessive grid: horizontal rules only, no frame, no verticals. */}
          {yTicks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--color-line-soft)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 6}
                y={y(t) + 3.5}
                textAnchor="end"
                className="tnum"
                fontSize={compact ? 9 : 10}
                fill="var(--color-placeholder)"
              >
                {t.toFixed(decimals === 0 ? 0 : decimals)}
              </text>
            </g>
          ))}

          {/* Zero, where a z-score panel needs it stated. */}
          {bands && lo < 0 && hi > 0 && (
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(0)}
              y2={y(0)}
              stroke="var(--color-line)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}

          {/* The x axis, with a tick under every reading and a label under as
              many of them as fit. */}
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={PAD.top + PH}
            y2={PAD.top + PH}
            stroke="var(--color-line)"
            strokeWidth={1}
          />
          {points.map((p, i) => (
            <line
              key={`tick-${p.date}`}
              x1={x(i)}
              x2={x(i)}
              y1={PAD.top + PH}
              y2={PAD.top + PH + 3}
              stroke="var(--color-line)"
              strokeWidth={1}
            />
          ))}
          {xTicks.map((i) => (
            <text
              key={`lab-${points[i].date}`}
              x={x(i)}
              y={PAD.top + PH + (compact ? 13 : 16)}
              textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
              className="tnum"
              fontSize={compact ? 9 : 10}
              fill="var(--color-placeholder)"
            >
              {axisDate(points[i].date)}
            </text>
          ))}

          {/* Crosshair under the marks, so it never sits on top of a value. */}
          {hovered && (
            <line
              x1={x(hover as number)}
              x2={x(hover as number)}
              y1={PAD.top}
              y2={PAD.top + PH}
              stroke="var(--color-navy-600)"
              strokeWidth={1}
              opacity={0.35}
            />
          )}

          {segments.map((seg, si) => (
            <polyline
              key={si}
              points={seg.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')}
              fill="none"
              stroke="var(--color-navy-600)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {/* Markers with a 2px surface ring, so two close readings stay two
              readings. */}
          {points.map((p, i) =>
            p.value === null ? null : (
              <circle
                key={p.date}
                cx={x(i)}
                cy={y(p.value)}
                r={hover === i ? 5 : compact ? 3 : 3.8}
                fill="var(--color-navy-600)"
                stroke="#fff"
                strokeWidth={2}
              />
            ),
          )}
        </svg>

        {hovered && (
          <div
            className="pointer-events-none absolute top-1 rounded-[8px] bg-navy-900 px-2 py-1 whitespace-nowrap text-white shadow-[0_6px_16px_-6px_rgba(4,12,36,0.6)]"
            style={{
              fontSize: compact ? 9 : 10,
              left: x(hover as number),
              transform:
                (hover as number) > points.length / 2
                  ? 'translateX(calc(-100% - 8px))'
                  : 'translateX(8px)',
            }}
          >
            <span className="tnum font-semibold">
              {(hovered.value as number).toFixed(decimals)}
              {unit}
            </span>
            <span className="ml-1.5 text-navy-100/80">{formatDate(hovered.date)}</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <figure className="rounded-[12px] bg-white shadow-[inset_0_0_0_1px_var(--color-line)]">
      <figcaption
        className={cx(
          'flex items-baseline justify-between gap-2',
          compact ? 'px-3 pt-2 pb-0.5' : 'px-4 pt-3 pb-1',
        )}
      >
        <span
          className={cx(
            'font-semibold tracking-[0.07em] text-muted uppercase',
            compact ? 'text-[9.5px]' : 'text-[10px]',
          )}
        >
          {title}
        </span>
        {last && (
          <span
            className={cx(
              'tnum font-semibold text-navy-900',
              compact ? 'text-[10.5px]' : 'text-[12px]',
            )}
          >
            {last.value.toFixed(decimals)}
            {unit && <span className="ml-0.5 font-normal text-muted">{unit}</span>}
          </span>
        )}
      </figcaption>
      <div ref={box} className={compact ? 'px-1 pb-1' : 'px-2 pb-2'}>
        {body()}
      </div>
    </figure>
  )
}

/** The readings as a table. Every chart in this app owes a reader who cannot
    or would rather not read a picture the same numbers. */
export function GrowthTable({
  rows,
}: {
  rows: {
    date: string
    height: number | null
    weight: number | null
    bmi: number | null
    z: number | null
    by: string
  }[]
}) {
  return (
    <div className="overflow-x-auto rounded-[12px] shadow-[inset_0_0_0_1px_var(--color-line)]">
      <table className="w-full min-w-[440px] border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-line text-[9.5px] font-semibold tracking-[0.06em] text-placeholder uppercase">
            <th className="px-3 py-2 text-left">Date</th>
            <th className="px-3 py-2 text-right">Height</th>
            <th className="px-3 py-2 text-right">Weight</th>
            <th className="px-3 py-2 text-right">BMI</th>
            <th className="px-3 py-2 text-right">BMI z</th>
            <th className="px-3 py-2 text-left">Recorded by</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-soft">
          {rows.map((r) => (
            <tr key={r.date}>
              <td className="px-3 py-1.5 font-medium whitespace-nowrap text-navy-900">{formatDate(r.date)}</td>
              <Num v={r.height} />
              <Num v={r.weight} />
              <Num v={r.bmi} />
              <Num v={r.z} signed />
              <td className="truncate px-3 py-1.5 text-muted">{r.by}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Num({ v, signed }: { v: number | null; signed?: boolean }) {
  return (
    <td className={cx('tnum px-3 py-1.5 text-right', v === null ? 'text-placeholder' : 'text-ink')}>
      {v === null ? '–' : signed && v > 0 ? `+${v.toFixed(2)}` : v.toFixed(signed ? 2 : 1)}
    </td>
  )
}
