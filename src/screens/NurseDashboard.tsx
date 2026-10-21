import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import CalendarPanel from '@/components/CalendarPanel'
import {
  Banner,
  BarsCard,
  ClassificationCard,
  BentoPage,
  GrowthCard,
  PriorityRail,
  UpcomingEventCard,
  WeighedCard,
  followCounts,
  isFlagged,
} from '@/components/bento'
import { TODAY, type Learner } from '@/data/mock'
import { useRoster } from '@/lib/records'
import { pct, summarise, summariseBySection } from '@/lib/summary'

/* The nurse's home. Only what she acts on, nothing she has to study.

     banner        who, today, what is outstanding, start weigh-in
     by grade      the share needing monitoring, grade by grade
     classification  the WHO bands, BMI or height, and normal vs monitoring
     growth        the share off normal, weigh-in round by round
     weighed       weighed, absent, not yet - and the grade most behind
     rail          calendar, then priority cases - severe, or two problems
                   at once - then the meeting

   The calendar moved from the main column to the head of the rail on
   2026-10-10, so the priority list is half the rail rather than all of it.
   The cards themselves live in components/bento.tsx. */

const AS_OF = TODAY

/* Where the flagged learners are: one bar per grade, the share of that
   grade's MEASURED learners needing monitoring, against the school's share.
   The worst grade is picked out by default. */
function MonitoringByGrade({ learners }: { learners: Learner[] }) {
  const rows = useMemo(() => summariseBySection(learners, AS_OF, () => ''), [learners])
  const s = useMemo(() => summarise(learners, AS_OF), [learners])
  const school = pct(s.needsMonitoring, s.measured)
  const bars = rows
    .filter((r) => r.measured > 0)
    .map((r) => ({
      key: r.section,
      label: r.section.replace('Grade ', 'G'),
      share: pct(r.needsMonitoring, r.measured),
      title: `${r.section}: ${r.needsMonitoring} of ${r.measured} measured need monitoring`,
      detail: (
        <>
          <span className="font-semibold">{r.section}</span> · {r.needsMonitoring} of {r.measured} measured
        </>
      ),
    }))
  const worst = bars.reduce<(typeof bars)[number] | null>((w, b) => (!w || b.share > w.share ? b : w), null)

  return (
    <BarsCard
      label="Need monitoring by grade"
      value={`${school}%`}
      sub="school average"
      bars={bars}
      defaultKey={worst?.key ?? null}
      avg={school}
      avgLabel="Average"
    />
  )
}

export default function NurseDashboard() {
  const { learners, install, meeting, absentIds } = useRoster()
  const navigate = useNavigate()

  const s = useMemo(() => summarise(learners, AS_OF), [learners])
  const flagged = useMemo(() => learners.filter(isFlagged), [learners])
  const follow = useMemo(() => followCounts(flagged), [flagged])

  return (
    <BentoPage
      rail={
        <>
          {/* The calendar heads the rail (moved from the main column,
              2026-10-10) and the priority list takes what is left under it. */}
          <CalendarPanel compact className="shrink-0" learners={learners} meeting={meeting} />
          <div className="min-h-0 xl:flex-1">
            <PriorityRail learners={learners} onOpen={(l) => navigate(`/learners?learner=${encodeURIComponent(l.id)}`)} />
          </div>
          <UpcomingEventCard
            standalone
            meeting={meeting}
            onDoor={() => navigate('/attendance')}
            onSet={() => navigate('/slips')}
          />
        </>
      }
    >
      <Banner
        name={install?.adviser}
        summary={
          [
            s.notYetMeasured > 0 && `${s.notYetMeasured} still to weigh`,
            follow['need-slip'] > 0 && `${follow['need-slip']} slips to print`,
            follow['slip-out'] > 0 && `${follow['slip-out']} parents expected`,
          ]
            .filter(Boolean)
            .join(' · ') || 'No pending items'
        }
        onStart={() => navigate('/weigh-in')}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
        <div className="min-w-0">
          <MonitoringByGrade learners={learners} />
        </div>
        <div className="min-w-0">
          <ClassificationCard learners={learners} healthy={s.healthy} needsMonitoring={s.needsMonitoring} />
        </div>
      </div>

      {/* No parent follow-up card here: the rail's filters already count
          needs slip, slip out and attended, and the meeting sits under them. */}
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-8">
          <GrowthCard learners={learners} />
        </div>
        <div className="col-span-12 lg:col-span-4">
          <WeighedCard learners={learners} absentIds={absentIds} onGo={() => navigate('/weigh-in')} />
        </div>
      </div>
    </BentoPage>
  )
}
