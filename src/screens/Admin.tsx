import { useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { HeartStraight, ChartBar, Syringe } from '@phosphor-icons/react'
import { Panel, Blank, IconChip, cx } from '@/components/ui'
import {
  Banner,
  BentoPage,
  Card,
  CardHead,
  FollowUpCard,
  WeighedCard,
  followCounts,
  isFlagged,
} from '@/components/bento'
import { TODAY } from '@/data/mock'
import { useSchool, useSchoolInfo } from '@/lib/school-year'
import { isNurse, useRoster } from '@/lib/records'
import NurseDashboard from './NurseDashboard'
import { mixByGrade, pct, summarise, summariseBySection, type GradeMix } from '@/lib/summary'
import { BAND_COLOR, BMI_BANDS, HFA_BANDS } from '@/lib/nutrition'
import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartTip } from '@/components/charts'

/* The school head's overview. Chosen by the user from three drafts
   (2026-10-09, option B): a main column and a side rail, five cards in all,
   replacing a page of nine.

     main   banner        the school, the school year, start weigh-in
            grade chart   nutritional status grade by grade
            section table every section, ranked
     rail   weighed       how far the weigh-in has got
            status        normal, need monitoring, not measured
            follow-up     invitations and attendance, and the next meeting

   Dropped on purpose: the split by sex (it is on the SF8), the overlap panel
   (counted inside "need monitoring"), the full calendar (only the next
   meeting matters here) and the separate immunization panel (one line in
   the status card). The cards come from components/bento.tsx, the same kit
   as the nurse's Health overview. */

const AS_OF = TODAY

export default function Admin() {
  const { learners, ready, install, meeting, absentIds } = useRoster()
  const { schoolYear, advisers } = useSchoolInfo()
  const school = useSchool()
  const navigate = useNavigate()

  const s = useMemo(() => summarise(learners, AS_OF), [learners])
  const bySection = useMemo(
    () => summariseBySection(learners, AS_OF, (name) => advisers[name] || '—'),
    [learners, advisers],
  )
  const mix = useMemo(() => mixByGrade(learners), [learners])
  const flagged = useMemo(() => learners.filter(isFlagged), [learners])
  const follow = useMemo(() => followCounts(flagged), [flagged])

  /* Worst first on the share needing monitoring. Sections with nobody
     measured go last: 0% because nobody was weighed is not a healthy class. */
  const ranked = useMemo(
    () =>
      [...bySection].sort((a, b) => {
        if (!a.measured && !b.measured) return a.grade - b.grade
        if (!a.measured) return 1
        if (!b.measured) return -1
        return pct(b.needsMonitoring, b.measured) - pct(a.needsMonitoring, a.measured)
      }),
    [bySection],
  )

  if (!ready) {
    return (
      <div className="h-full px-6 pb-6">
        <Blank>Loading records…</Blank>
      </div>
    )
  }

  /* An unclaimed install goes back to sign-in. */
  if (!install) return <Navigate to="/" replace />

  /* The nurse has her own home on the same route. See NurseDashboard. */
  if (isNurse(install)) return <NurseDashboard />

  return (
    <BentoPage
      rail={
        <>
          <WeighedCard learners={learners} absentIds={absentIds} onGo={() => navigate('/weigh-in')} />
          <StatusCard
            registered={s.registered}
            healthy={s.healthy}
            needsMonitoring={s.needsMonitoring}
            notMeasured={s.notYetMeasured}
            immunized={s.immunized}
          />
          <FollowUpCard flagged={flagged} counts={follow} onGo={() => navigate('/slips')} meeting={meeting} />
        </>
      }
    >
      <Banner
        title={school.name}
        summary={`S.Y. ${schoolYear} · ${s.registered} learners · ${bySection.length} sections`}
        onStart={() => navigate('/weigh-in')}
      />
      <GradeMixChart rows={mix} />
      <SectionTable rows={ranked} />
    </BentoPage>
  )
}

/* --- Rail: the status of every registered learner ------------------------- */

function StatusCard({
  registered,
  healthy,
  needsMonitoring,
  notMeasured,
  immunized,
}: {
  registered: number
  healthy: number
  needsMonitoring: number
  notMeasured: number
  immunized: number
}) {
  const rows = [
    { label: 'Normal', n: healthy, color: 'var(--color-n)' },
    { label: 'Need monitoring', n: needsMonitoring, color: 'var(--color-sw)' },
    { label: 'Not measured', n: notMeasured, color: '#c5cedd' },
  ]
  return (
    <Card>
      <CardHead
        icon={<HeartStraight size={14} weight="fill" />}
        tone="green"
        eyebrow={`${registered} registered learners`}
        title="Nutritional status"
      />
      <ul className="mt-4 space-y-3.5">
        {rows.map((r) => (
          <li key={r.label}>
            <div className="flex items-baseline justify-between text-[12px]">
              <span className="font-medium text-navy-900">{r.label}</span>
              <span className="tnum">
                <span className="text-[15px] font-semibold text-navy-900">{r.n}</span>
                <span className="ml-1.5 text-[10.5px] text-muted">{pct(r.n, registered)}%</span>
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-wash">
              <div className="h-full rounded-full" style={{ width: `${pct(r.n, registered)}%`, background: r.color }} />
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-center gap-2 rounded-[12px] bg-wash px-3 py-2 text-[11.5px] text-navy-900">
        <Syringe size={13} weight="fill" className="shrink-0 text-navy-700" />
        <span>
          Immunization up to date: <span className="tnum font-semibold">{immunized}</span> of{' '}
          <span className="tnum">{registered}</span>
        </span>
      </div>
    </Card>
  )
}

/* --- Band 2, left: the status mix grade by grade -------------------------
   One stacked bar per grade, the five BMI bands across it, each segment as a
   share of that grade's MEASURED learners.

   Stacked rather than grouped, because the question is composition - what is
   this class made of - and grouped bars answer a different one. Normalised to
   each grade's own measured count rather than drawn to absolute size, because
   the grades differ in how far through the weigh-in they are and an
   unnormalised chart would show Grade 6's shorter bar as a healthier class
   when it only means fewer children on the scale so far.

   Drawn by hand. This workstation never sees the network, so a charting
   library would have to be shipped, audited and kept current for the life of
   the install in order to draw thirty rectangles.
------------------------------------------------------------------------- */

/* The two indices, and the fact that this panel shows ONE at a time.

   That is the whole reason the toggle exists rather than a fixed BMI chart.
   With BMI alone the panel reported Grade 1 as 0% off normal while the
   section table below reported 13% - both correct, because the table ORs the
   two indices and the chart was banding one, and two numbers on the same
   screen that look like the same thing and disagree is a defect whichever of
   them is right. Naming the index in the toggle, in the summary column and in
   the row's own tooltip is what makes the two readings reconcilable.

   It also stops `mixByGrade` computing a height breakdown that nothing drew -
   and on this roster height is the dominant problem (15 stunted-only against
   6 wasted-only), so a BMI-only chart was hiding the larger half. */
const INDEX = {
  bmi: { label: 'BMI-for-age', bands: BMI_BANDS as readonly string[], short: 'off BMI' },
  hfa: { label: 'Height-for-age', bands: HFA_BANDS as readonly string[], short: 'off height' },
} as const

type IndexKey = keyof typeof INDEX

function GradeMixChart({ rows }: { rows: GradeMix[] }) {
  const [index, setIndex] = useState<IndexKey>('bmi')
  const anyMeasured = rows.some((r) => r.measured > 0)
  const { bands, short, label } = INDEX[index]
  const countsOf = (r: GradeMix) =>
    (index === 'bmi' ? r.bmi : r.hfa) as Record<string, number>

  return (
    <Panel
      bodyClass="flex flex-col px-5 pb-5"
      title={
        <span className="flex items-center gap-2">
          <IconChip tone="blue">
            <ChartBar size={14} weight="fill" />
          </IconChip>
          Nutritional status by grade
        </span>
      }
      subtitle={`${label}. Each bar shows the share of that grade's measured learners.`}
      actions={
        <div className="flex items-center gap-0.5 rounded-full bg-wash p-0.5">
          {(Object.keys(INDEX) as IndexKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setIndex(k)}
              aria-pressed={index === k}
              className={cx(
                'rounded-full px-2.5 py-1 text-[11px] font-medium whitespace-nowrap',
                'transition-colors duration-100',
                index === k ? 'bg-navy-800 text-white' : 'text-muted hover:text-navy-900',
              )}
            >
              {INDEX[k].label}
            </button>
          ))}
        </div>
      }
    >
      {!anyMeasured ? (
        <Blank>No measurements recorded.</Blank>
      ) : (
        <>
        {/* The legend belongs under the toggle rather than in the header
            beside it: the band names change with the index, and a legend that
            resizes the header row makes the panel jump when it is switched. */}
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          {bands.map((b) => (
            <span key={b} className="flex items-center gap-1.5 text-[10px] text-muted">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: BAND_COLOR[b as keyof typeof BAND_COLOR] }}
              />
              {b}
            </span>
          ))}
        </div>
        <GradeMixBars rows={rows} bands={bands} counts={countsOf} label={label} short={short} />
        </>
      )}
    </Panel>
  )
}

/* The stacked bars themselves, in Recharts since 2026-10-10.

   One horizontal bar per grade, each band as a share of that grade's
   measured learners. The bar runs to 100 and a transparent segment after it
   (GAP wide) carries the "% off" figure, so that column stays aligned with
   its row - the same figure, labelled with the index, that the hand-drawn
   version printed in a column of its own (see the note on INDEX above). */
const GAP = 22

function GradeMixBars({
  rows,
  bands,
  counts,
  label,
  short,
}: {
  rows: GradeMix[]
  bands: readonly string[]
  counts: (r: GradeMix) => Record<string, number>
  label: string
  short: string
}) {
  const data = rows.map((r) => {
    const c = counts(r)
    const row: Record<string, string | number> = {
      section: r.section,
      measured: r.measured,
      registered: r.registered,
      off: r.measured ? `${100 - pct(c.Normal ?? 0, r.measured)}%` : '–',
      gap: GAP,
    }
    for (const b of bands) row[b] = r.measured ? ((c[b] ?? 0) / r.measured) * 100 : 0
    return row
  })

  return (
    <ResponsiveContainer width="100%" height={rows.length * 38 + 8}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 0, bottom: 4, left: 0 }} barCategoryGap={10}>
        <XAxis type="number" hide domain={[0, 100 + GAP]} />
        <YAxis
          type="category"
          dataKey="section"
          width={96}
          axisLine={false}
          tickLine={false}
          tick={({ x, y, payload, index }) => {
            const d = data[index]
            return (
              <g transform={`translate(${Math.max(2, Number(x) - 86)},${Number(y)})`}>
                <text y={-2} fontSize={11.5} fontWeight={500} fill="#0e2464">
                  {payload.value}
                </text>
                <text y={11} fontSize={10} fill="#68768e">
                  {d ? `${d.measured}/${d.registered} weighed` : ''}
                </text>
              </g>
            )
          }}
        />
        <Tooltip
          cursor={{ fill: 'var(--color-wash)', radius: 8 }}
          content={({ active, payload }) => {
            const d = active && payload?.[0] ? (payload[0].payload as (typeof data)[number]) : null
            if (!d) return null
            const measured = Number(d.measured)
            return (
              <ChartTip title={`${d.section} · ${label}`}>
                {measured === 0 ? (
                  <div>Not measured</div>
                ) : (
                  bands.map((b) => {
                    const share = Number(d[b])
                    return (
                      <div key={b} className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full" style={{ background: BAND_COLOR[b as keyof typeof BAND_COLOR] }} />
                        {b}: {Math.round((share * measured) / 100)} ({Math.round(share)}%)
                      </div>
                    )
                  })
                )}
              </ChartTip>
            )
          }}
        />
        {bands.map((b) => (
          <Bar
            key={b}
            dataKey={b}
            stackId="mix"
            fill={BAND_COLOR[b as keyof typeof BAND_COLOR]}
            stroke="#fff"
            strokeWidth={1.5}
            radius={4}
            barSize={20}
          />
        ))}
        <Bar dataKey="gap" stackId="mix" fill="transparent" barSize={20} isAnimationActive={false}>
          <LabelList
            dataKey="off"
            content={({ x, y, width, height, value }) => (
              <text
                x={Number(x) + Number(width) - 2}
                y={Number(y) + Number(height) / 2}
                textAnchor="end"
                dominantBaseline="central"
                fontSize={11}
                fontWeight={600}
                fill="#0e2464"
              >
                {String(value)}
                <tspan fontSize={9} fontWeight={400} fill="#68768e">{` ${short}`}</tspan>
              </text>
            )}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/* --- Band 4: the sections, ranked ----------------------------------------
   Full width, because it is eight columns of figures and eight twelfths of a
   grid crushed the bars into stubs. It is last rather than first because it
   is the detail behind every band above it: a reader who wants the ranking
   scrolls to it, and a reader who wanted the answer already had it.
------------------------------------------------------------------------- */

function SectionTable({ rows }: { rows: ReturnType<typeof summariseBySection> }) {
  const worst = Math.max(1, ...rows.map((r) => pct(r.needsMonitoring, r.measured)))

  return (
    <Panel bodyClass="flex min-h-0 flex-1 flex-col px-5 pt-4 pb-4">
      {rows.length === 0 ? (
        <Blank>No sections on file.</Blank>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              {/* Which column absorbs the slack is the whole layout of this
                  table, and it used to be the wrong one.

                  Section had no width, so it took every spare pixel: on a
                  1366px screen the name sat alone in a 500px cell with the
                  figures shoved against the right edge and the monitoring
                  bars drawn as 200px stubs. The name needs enough room for
                  "Mrs. C. Delos Reyes" and not one pixel more.

                  The slack goes to the bar instead. It is the only cell here
                  that is a COMPARISON rather than a number, so it is the only
                  one that gets better the wider it is - and the ranking this
                  table is sorted by is exactly what those lengths show. */}
              <tr className="text-[10px] tracking-[0.06em] text-placeholder uppercase">
                <Th className="w-[170px]">Section</Th>
                <Th className="w-[76px] text-right">Learners</Th>
                <Th className="w-[96px] text-right">Measured</Th>
                <Th className="w-[70px] text-right">Normal</Th>
                <Th className="min-w-[180px]">Need monitoring</Th>
                <Th className="w-[86px] text-right">Follow-up</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const share = pct(r.needsMonitoring, r.measured)
                return (
                  <tr
                    key={r.section}
                    className="border-t border-line-soft transition-colors duration-100 hover:bg-wash"
                  >
                    <Td>
                      <span className="block text-[12px] font-medium whitespace-nowrap text-navy-900">
                        {r.section}
                      </span>
                      <span className="block truncate text-[10px] text-muted">{r.adviser}</span>
                    </Td>
                    <Td className="tnum text-right text-[11.5px] text-navy-900">{r.registered}</Td>
                    <Td className="tnum text-right text-[11.5px] text-muted">
                      {r.measured}
                      <span className="ml-1 text-[10px] text-placeholder">
                        ({pct(r.measured, r.registered)}%)
                      </span>
                    </Td>
                    <Td className="tnum text-right text-[11.5px] text-navy-900">{r.healthy}</Td>
                    <Td>
                      {/* A bar, not just a percentage. Six rows of figures
                          answer "how many"; the question here is "which one is
                          worst", and that is a comparison of lengths. Scaled to
                          the worst section rather than to 100, so the spread
                          between six classes is visible instead of six short
                          stubs against an empty track. */}
                      {r.measured === 0 ? (
                        <span className="text-[11px] text-placeholder">Not measured</span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-wash">
                            <span
                              className="block h-full rounded-full"
                              style={{
                                width: `${Math.round((share / worst) * 100)}%`,
                                background: BAND_COLOR.Wasted,
                              }}
                            />
                          </span>
                          <span className="tnum w-14 shrink-0 text-right text-[11.5px] font-medium text-navy-900">
                            {r.needsMonitoring}
                            <span className="ml-1 text-[10px] text-muted">({share}%)</span>
                          </span>
                        </span>
                      )}
                    </Td>
                    <Td className="tnum text-right text-[11.5px] font-medium text-navy-900">
                      {r.pendingFollowups}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={cx('px-2 py-2 text-left font-semibold whitespace-nowrap', className)}>
      {children}
    </th>
  )
}

function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cx('px-2 py-2.5 align-middle', className)}>{children}</td>
}
