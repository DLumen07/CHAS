import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { EffectScatterChart, LineChart } from 'echarts/charts'
import { GridComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import type { EChartsCoreOption } from 'echarts/core'

/* Apache ECharts, for the weigh-in growth trends (2026-10-12, the user's
   request to move off Recharts there). Bundled with the app like everything
   else, so it works offline.

   Only the parts the charts use are registered - line, the pulsing point,
   the grid, the tooltip and the normal-range band - so the rest of the
   library stays out of the bundle. SVG rendering keeps the lines crisp at
   any zoom. */

echarts.use([LineChart, EffectScatterChart, GridComponent, TooltipComponent, MarkAreaComponent, MarkLineComponent, SVGRenderer])

export { echarts }

/** One chart, filling its parent. Re-sizes with the parent and is disposed
    on unmount; a new `option` replaces the old one outright. */
export function EChart({ option, className }: { option: EChartsCoreOption; className?: string }) {
  const host = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return
    const c = echarts.init(el, null, { renderer: 'svg' })
    chart.current = c
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(el)
    return () => {
      ro.disconnect()
      c.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true })
  }, [option])

  return <div ref={host} className={className ?? 'h-full w-full'} />
}
