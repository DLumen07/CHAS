import { useId, type ReactNode } from 'react'

/* Shared pieces for the Recharts charts (added 2026-10-10, when the
   dashboards moved off hand-drawn SVG). Recharts is bundled with the app,
   so nothing is fetched at runtime and the charts work offline.

   One look for every chart: navy tooltip, muted axis text, no axis lines,
   the royal-blue family for structure and the clinical colours only where
   they name a band. */

export const AXIS_TICK = { fontSize: 10, fill: '#8a97ad' } as const
export const GRID = '#f0f3f9'

/** A gradient id that is unique per chart and safe inside url(#...). */
export function useGradientId(prefix: string): string {
  return `${prefix}-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
}

/** The tooltip box every chart shows on hover. */
export function ChartTip({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="pointer-events-none rounded-[10px] bg-navy-900 px-3 py-2 text-white shadow-[0_10px_24px_-10px_rgba(4,12,36,0.6)]">
      <div className="tnum text-[12px] font-semibold">{title}</div>
      {children && <div className="tnum mt-0.5 space-y-0.5 text-[10.5px] text-[#b9c6ea]">{children}</div>}
    </div>
  )
}

/** An x-axis label that wraps onto two lines at the first space past the
    middle, so "Severely wasted" sits under its bar instead of overlapping. */
export function WrapTick({
  x,
  y,
  payload,
  activeLabel,
}: {
  x?: number | string
  y?: number | string
  payload?: { value: string }
  activeLabel?: string | null
}) {
  const text = payload?.value ?? ''
  const words = text.split(' ')
  const lines = words.length > 1 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : [text]
  /* The picked bar's label changes colour, not weight: a bold "Overweight"
     is wider than its slot and runs into the next label. */
  const on = activeLabel === text
  return (
    <text
      x={Number(x)}
      y={Number(y) + 2}
      textAnchor="middle"
      fontSize={9.5}
      fontWeight={on ? 600 : 500}
      letterSpacing={-0.1}
      fill={on ? '#0e2464' : '#5a6b85'}
    >
      {lines.map((l, i) => (
        <tspan key={i} x={Number(x)} dy={i === 0 ? 8 : 10.5}>
          {l}
        </tspan>
      ))}
    </text>
  )
}
