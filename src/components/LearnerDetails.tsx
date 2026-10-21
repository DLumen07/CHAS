import { memo, useMemo, type ReactNode } from 'react'
import { Check, NotePencil } from '@phosphor-icons/react'
import { cx } from './ui'
import { DoseChip, LABELS } from './form'
import { IMMUNIZATION_LABEL, type Learner } from '../data/mock'
import {
  BAND_COLOR,
  BMI_CUTOFFS,
  HFA_CUTOFFS,
  ageInMonths,
  classifyBmiForAge,
  classifyHeightForAge,
  zHeightForAge,
} from '../lib/nutrition'
import type { GrowthRow } from '../lib/growth'
import type { ApiLearnerRecord, ConditionStatus } from '../lib/api'

/* The lower part of the learner profile: the record in detail (2026-10-21).

   Replaces the ruled sheet sections with cards that read at a glance:
   where the learner sits on each WHO scale, how the figures have moved this
   school year, every weigh-in with the nurse's note, the invitation as three
   steps, the health history and the immunization card. Same data as before;
   nothing here is new on the server except the weigh-in note.

   All of it is pure display over the record already loaded, memoised, so
   opening a profile costs one render. */

/* --- Shared ---------------------------------------------------------------- */

export function DetailCard({
  title,
  aside,
  children,
  className,
}: {
  title: string
  aside?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cx('rounded-[16px] bg-white p-4 shadow-[inset_0_0_0_1px_var(--color-line)]', className)}>
      <div className="mb-3 flex items-baseline gap-3">
        <h3 className="flex-1 font-display text-[13.5px] font-extrabold text-navy-900">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

function mdy(iso: string): string {
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${m}/${d}/${y}` : iso
}

function dayOf(s: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return mdy(s)
  const d = new Date(s)
  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
}

const signed = (n: number, digits = 1) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}`

/* --- 1. Where the learner sits on each scale -------------------------------- */

/** The scale shown, -4 to +4 standard deviations. */
const LO = -4
const HI = 4
const pos = (z: number) => ((Math.min(HI, Math.max(LO, z)) - LO) / (HI - LO)) * 100

function Scale({
  title,
  value,
  z,
  cutoffs,
}: {
  title: string
  value: string
  z: number | null
  cutoffs: { band: string; min: number; max: number }[]
}) {
  const band = z === null ? null : cutoffs.find((c) => z >= c.min && z < c.max)?.band ?? null
  const color = band ? BAND_COLOR[band as keyof typeof BAND_COLOR] : undefined
  return (
    <div className="rounded-[14px] bg-wash p-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11.5px] font-semibold text-muted">{title}</span>
        {band && (
          <span
            className="rounded-full px-2.5 py-0.5 text-[11.5px] font-bold"
            style={{ color, background: `color-mix(in srgb, ${color} 10%, white)` }}
          >
            {band}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="tnum font-display text-[22px] leading-tight font-extrabold text-navy-900">{value}</span>
        {z !== null && <span className="tnum text-[12px] text-muted">z {signed(z, 2)}</span>}
      </div>
      {/* The bands as a strip, the learner as a marker on it. */}
      <div className="relative mt-3 h-[22px]">
        <div className="absolute top-[6px] right-0 left-0 flex h-[10px] overflow-hidden rounded-full">
          {cutoffs.map((c) => (
            <span
              key={c.band}
              title={c.band}
              style={{
                width: `${pos(c.max) - pos(c.min)}%`,
                background: BAND_COLOR[c.band as keyof typeof BAND_COLOR],
                opacity: band === c.band ? 1 : 0.28,
              }}
            />
          ))}
        </div>
        {z !== null && (
          <span
            className="absolute top-0 h-[22px] w-[4px] -translate-x-1/2 rounded-full bg-navy-900 ring-2 ring-white"
            style={{ left: `${pos(z)}%` }}
          />
        )}
      </div>
      <div className="tnum relative mt-0.5 h-3.5 text-[10.5px] text-muted">
        {[-3, -2, 0, 2, 3].map((t) => (
          <span key={t} className="absolute -translate-x-1/2" style={{ left: `${pos(t)}%` }}>
            {t > 0 ? `+${t}` : t < 0 ? `−${-t}` : '0'}
          </span>
        ))}
      </div>
    </div>
  )
}

/* --- 2. How the figures moved this year ------------------------------------- */

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-[14px] px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
      <div className="truncate text-[11.5px] text-muted">{label}</div>
      <div className={cx('tnum mt-0.5 text-[16px] leading-snug font-bold text-navy-900', tone)}>{value}</div>
      {note && <div className="mt-0.5 truncate text-[11px] text-muted">{note}</div>}
    </div>
  )
}

export const NutritionDetails = memo(function NutritionDetails({
  record,
  rows,
  schoolYearStart,
  charts,
}: {
  record: ApiLearnerRecord
  /** Oldest first. */
  rows: GrowthRow[]
  schoolYearStart: number
  /** The growth charts toggle and panel, drawn under the list. */
  charts: ReactNode
}) {
  const months = (date: string) => (record.birthDate ? ageInMonths(record.birthDate, date) : null)
  const enriched = useMemo(
    () =>
      rows.map((r) => {
        const m = months(r.date)
        const hz = r.height && m !== null ? zHeightForAge(r.height, m, record.sex) : null
        return { ...r, hz }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, record.birthDate, record.sex],
  )
  const latest = enriched.at(-1) ?? null
  const year = enriched.filter((r) => r.date >= `${schoolYearStart}-06-01`)
  const first = year[0]
  const last = year.at(-1)
  const moved = first && last && first !== last

  const weightChange = moved && first.weight !== null && last.weight !== null ? last.weight - first.weight : null
  const heightChange = moved && first.height !== null && last.height !== null ? last.height - first.height : null
  const zChange = moved && first.z !== null && last.z !== null ? last.z - first.z : null
  /* Towards 0 is towards the middle of Normal, whichever side the learner
     started on. */
  const better = zChange !== null && first && last && first.z !== null && last.z !== null ? Math.abs(last.z) < Math.abs(first.z) : null
  const steady = zChange !== null && Math.abs(zChange) < 0.1
  const bothNormal =
    first?.z != null && last?.z != null && classifyBmiForAge(first.z) === 'Normal' && classifyBmiForAge(last.z) === 'Normal'

  const newestFirst = useMemo(() => enriched.slice().reverse(), [enriched])

  return (
    <DetailCard
      title="Nutritional status"
      aside={latest && <span className="text-[11.5px] text-muted">Latest {mdy(latest.date)}</span>}
    >
      {!latest ? (
        <p className="rounded-[12px] bg-wash px-4 py-3 text-[12.5px] text-muted">No measurements recorded.</p>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-2.5 md:grid-cols-2">
            <Scale
              title="BMI-for-age"
              value={latest.bmi !== null ? `BMI ${latest.bmi.toFixed(1)}` : '—'}
              z={latest.z}
              cutoffs={BMI_CUTOFFS.map((c) => ({ ...c, min: Math.max(c.min, LO), max: Math.min(c.max, HI) }))}
            />
            <Scale
              title="Height-for-age"
              value={latest.height !== null ? `${latest.height.toFixed(1)} cm` : '—'}
              z={latest.hz}
              cutoffs={HFA_CUTOFFS.map((c) => ({ ...c, min: Math.max(c.min, LO), max: Math.min(c.max, HI) }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <Stat
              label="Weight change"
              value={weightChange !== null ? `${signed(weightChange)} kg` : '—'}
              note={moved ? `Since ${mdy(first.date)}` : 'One weigh-in this year'}
            />
            <Stat
              label="Height change"
              value={heightChange !== null ? `${signed(heightChange)} cm` : '—'}
              note={moved ? `Since ${mdy(first.date)}` : 'One weigh-in this year'}
            />
            <Stat
              label="BMI z-score change"
              value={zChange !== null ? signed(zChange, 2) : '—'}
              note={
                better === null
                  ? 'Needs two weigh-ins'
                  : steady
                    ? 'No real change'
                    : bothNormal
                      ? 'Within Normal'
                      : better
                        ? 'Moving towards Normal'
                        : 'Moving away from Normal'
              }
              tone={
                better === null || steady || bothNormal ? undefined : better ? 'text-[var(--color-n)]' : 'text-[var(--color-w)]'
              }
            />
            <Stat label="Weigh-ins this year" value={String(year.length)} note={`${enriched.length} on file in total`} />
          </div>

          {/* Every weigh-in, newest first, with the nurse's note. */}
          <ol className="overflow-hidden rounded-[14px] shadow-[inset_0_0_0_1px_var(--color-line)]">
            <li className="grid grid-cols-[96px_repeat(3,minmax(0,1fr))_minmax(0,1.3fr)_minmax(0,1.3fr)] gap-2 bg-wash px-3.5 py-2 text-[11px] font-semibold text-muted">
              <span>Date</span>
              <span>Height</span>
              <span>Weight</span>
              <span>BMI</span>
              <span>BMI-for-age</span>
              <span>Height-for-age</span>
            </li>
            {newestFirst.map((r) => {
              const bb = r.z === null ? null : classifyBmiForAge(r.z)
              const hb = r.hz === null ? null : classifyHeightForAge(r.hz)
              return (
                <li key={r.date} className="border-t border-line-soft px-3.5 py-2.5 text-[12.5px]">
                  <div className="grid grid-cols-[96px_repeat(3,minmax(0,1fr))_minmax(0,1.3fr)_minmax(0,1.3fr)] items-baseline gap-2">
                    <span className="tnum font-semibold text-navy-900">{mdy(r.date)}</span>
                    <span className="tnum">{r.height !== null ? `${r.height.toFixed(1)} cm` : '—'}</span>
                    <span className="tnum">{r.weight !== null ? `${r.weight.toFixed(1)} kg` : '—'}</span>
                    <span className="tnum">{r.bmi !== null ? r.bmi.toFixed(1) : '—'}</span>
                    <BandText band={bb} />
                    <BandText band={hb} />
                  </div>
                  {r.note && (
                    <p className="mt-1.5 flex items-start gap-1.5 rounded-[10px] bg-gold-100/60 px-2.5 py-1.5 text-[12px] leading-snug text-navy-900">
                      <NotePencil size={13} weight="bold" className="mt-px shrink-0 text-gold-700" />
                      <span className="min-w-0">{r.note}</span>
                    </p>
                  )}
                  <div className="mt-1 text-[11px] text-muted">Recorded by {r.by}</div>
                </li>
              )
            })}
          </ol>

          {charts}
        </div>
      )}
    </DetailCard>
  )
})

function BandText({ band }: { band: string | null }) {
  if (!band) return <span className="text-muted">—</span>
  return (
    <span className="truncate font-bold" style={{ color: BAND_COLOR[band as keyof typeof BAND_COLOR] }}>
      {band}
    </span>
  )
}

/* --- 3. The invitation as three steps ---------------------------------------- */

export function InvitationSteps({ learner: l }: { learner: Learner }) {
  const flagged =
    !!l.measuredOn &&
    ((l.bmiBand && l.bmiBand !== 'Normal') || (l.hfaBand && l.hfaBand !== 'Normal' && l.hfaBand !== 'Tall'))
  const steps = [
    { label: 'For follow-up', done: !!flagged || !!l.printedAt, note: flagged ? 'Not Normal' : l.measuredOn ? 'Normal' : 'Not measured' },
    { label: 'Slip printed', done: !!l.printedAt, note: l.printedAt ? dayOf(l.printedAt) : 'Not printed' },
    { label: 'Parent attended', done: !!l.attendedAt, note: l.attendedAt ? dayOf(l.attendedAt) : 'Not yet' },
  ]
  return (
    <DetailCard title="Invitation">
      <ol className="space-y-2.5">
        {steps.map((s, i) => (
          <li key={s.label} className="flex items-center gap-3">
            <span
              className={cx(
                'grid size-7 shrink-0 place-items-center rounded-full text-[12px] font-bold',
                s.done ? 'bg-navy-900 text-white' : 'bg-wash text-muted',
              )}
            >
              {s.done ? <Check size={13} weight="bold" /> : i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-navy-900">{s.label}</span>
              <span className="tnum block text-[11.5px] text-muted">{s.note}</span>
            </span>
          </li>
        ))}
      </ol>
      {l.slipMeeting && (
        <p className="mt-3 rounded-[10px] bg-wash px-3 py-2 text-[11.5px] text-muted">
          Meeting {mdy(l.slipMeeting.date)} · {l.slipMeeting.time} · {l.slipMeeting.venue}
        </p>
      )}
    </DetailCard>
  )
}

/* --- 4. Health history ------------------------------------------------------- */

const CONDITION_TONE: Record<ConditionStatus, string> = {
  ACTIVE: 'bg-[#fdf2f5] text-[#9f1239]',
  RECURRING: 'bg-gold-100 text-gold-700',
  RESOLVED: 'bg-[#e6f4ec] text-[#136c34]',
  UNKNOWN: 'bg-wash text-muted',
}

export function HealthHistory({ record }: { record: ApiLearnerRecord }) {
  const active = record.conditions.filter((c) => c.status === 'ACTIVE' || c.status === 'RECURRING').length
  return (
    <DetailCard
      title="Health history"
      aside={
        <span className="text-[11.5px] text-muted">
          {record.conditions.length === 0 ? 'None reported' : `${active} active of ${record.conditions.length}`}
        </span>
      }
    >
      {record.conditions.length === 0 ? (
        <p className="rounded-[12px] bg-wash px-4 py-3 text-[12.5px] text-muted">No conditions reported.</p>
      ) : (
        <ul className="space-y-2">
          {record.conditions.map((c) => (
            <li key={c.id} className="rounded-[12px] bg-wash px-3.5 py-2.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-navy-900">{c.condition}</span>
                <span className={cx('rounded-full px-2.5 py-0.5 text-[11px] font-bold', CONDITION_TONE[c.status])}>
                  {LABELS.condition[c.status]}
                </span>
              </div>
              {c.treatment && (
                <p className="mt-1 text-[12px] leading-snug whitespace-pre-line text-navy-900">
                  <span className="text-muted">Treatment: </span>
                  {c.treatment}
                </p>
              )}
              {c.notes && <p className="mt-0.5 text-[12px] leading-snug whitespace-pre-line text-muted">{c.notes}</p>}
            </li>
          ))}
        </ul>
      )}
      {record.healthNotes && (
        <p className="mt-3 text-[12.5px] leading-relaxed whitespace-pre-line text-navy-900">
          <span className="block text-[11.5px] font-semibold text-muted">Notes</span>
          {record.healthNotes}
        </p>
      )}
    </DetailCard>
  )
}

/* --- 5. Immunization ---------------------------------------------------------- */

export function Immunization({ learner: l, record }: { learner: Learner; record: ApiLearnerRecord }) {
  const doses = record.vaccineDoses
  const given = doses.filter((d) => d.status === 'GIVEN').length
  const share = doses.length ? given / doses.length : 0
  return (
    <DetailCard
      title="Immunization"
      aside={
        <span
          className={cx(
            'text-[12px] font-bold',
            l.immunization === 'complete' ? 'text-[var(--color-n)]' : 'text-[var(--color-w)]',
          )}
        >
          {IMMUNIZATION_LABEL[l.immunization]}
        </span>
      }
    >
      {doses.length === 0 ? (
        <p className="rounded-[12px] bg-wash px-4 py-3 text-[12.5px] text-muted">No vaccines recorded.</p>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-wash">
              <div className="h-full rounded-full bg-[var(--color-n)]" style={{ width: `${share * 100}%` }} />
            </div>
            <span className="tnum shrink-0 text-[12px] font-semibold text-navy-900">
              {given} of {doses.length} recorded doses given
            </span>
          </div>
          <table className="mt-3 w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] text-muted">
                {['Vaccine', 'Dose', 'Date given', 'Status', 'Remarks'].map((h) => (
                  <th key={h} scope="col" className="pr-3 pb-1.5 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {doses.map((d) => (
                <tr key={d.id} className="border-t border-line-soft">
                  <td className="py-2 pr-3 font-medium text-navy-900">{d.vaccine}</td>
                  <td className="tnum py-2 pr-3">{d.dose}</td>
                  <td className="tnum py-2 pr-3">{d.givenOn ? mdy(d.givenOn) : '—'}</td>
                  <td className="py-2 pr-3">
                    <DoseChip status={d.status} />
                  </td>
                  <td className="py-2 pr-3 text-muted">{d.remarks || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </DetailCard>
  )
}
