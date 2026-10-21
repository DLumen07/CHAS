import { forwardRef, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  CheckCircle,
  Warning,
  Plus,
  ArrowCounterClockwise,
  MagnifyingGlass,
  X,
  User,
  ArrowRight,
  CalendarBlank,
  CaretRight,
  ArrowLeft,
} from '@phosphor-icons/react'
import { PILL, PILL_OFF, PILL_ON, cx } from '@/components/ui'
import { ConfirmDialog, Modal, Select } from '@/components/primitives'
import { LearnerRecordDialog } from '@/components/LearnerRecordDialog'
import { Y } from '@/components/bento'
import { GrowthPanel, type PendingReading } from '@/components/WeighInGrowth'
import { TODAY, fullName, type Learner } from '@/data/mock'
import { formatDate, formatRange } from '@/lib/dates'
import { EndFollowUpDialog, StartFollowUpDialog } from '@/components/FollowUpDialog'
import { currentRound, inRound } from '@/lib/rounds'
import { toast } from '@/components/toast'
import { useRoster } from '@/lib/records'
import {
  BAND_COLOR,
  BMI_CUTOFFS,
  ageInMonths,
  assess,
  classifyHeightForAge,
  formatAge,
  zHeightForAge,
} from '../lib/nutrition'
import { classNames, schoolYearStart, useSchoolInfo } from '@/lib/school-year'

/* Weigh-in station. Redesigned 2026-10-11 from the user's chosen draft:
   the entry form beside a growth panel that places the reading on the
   learner's own chart before it is saved (components/WeighInGrowth.tsx),
   with the learner queue as a strip along the bottom.

   The nurse does one thing here, forty times an hour, with a child standing
   on a scale in front of her: read two numbers off an instrument and type
   them. The layout keeps that act in one place:

     context bar     the date saves are made with,
                     grade and search
     queue (right)   To measure / Measured / Absent, with "Next" marked -
                     the same column whether or not anyone is on the scale
                     (moved from the left on 2026-10-13, the user's request)
     left column     the learner on the scale: the two fields with the
                     change since last time beside the result on the WHO
                     scale, alerts, Save and next / Absent; and under it the
                     growth cards - BMI-for-age, height-for-age and weight,
                     each with the reading on the learner's own trend

   Trimmed on 2026-10-11 after the user found the first build crowded: no
   class median, no duplicate buttons or hint lines. The form moved out of
   the queue's column into the right one on 2026-10-12 (the user's request),
   so the list never shifts when a learner is picked.

   What the screen still refuses to do: ask her to press Calculate. The WHO
   classification is computed as the digits land, and height-for-age resolves
   as soon as the height is in, while the child is still on the stadiometer.

   Kept from before, because a weigh-in line needs all of it: any name in the
   queue can be picked (children do not arrive in roster order), a recorded
   child can be re-opened and corrected, and both indices are shown. */

export default function WeighIn() {
  const { learners, record, unrecord, skip, absentIds, clearError, followUp, startFollowUp, endFollowUp } = useRoster()
  const navigate = useNavigate()
  const [height, setHeight] = useState('')
  const [weight, setWeight] = useState('')
  /* The nurse's note on this weigh-in (2026-10-21): the context a figure
     needs, such as an illness. Optional; read beside the figures and never
     changes the classification. */
  const [note, setNote] = useState('')
  /* Null means "whoever is at the head of the queue". */
  const [activeId, setActiveId] = useState<string | null>(null)
  const heightRef = useRef<HTMLInputElement>(null)

  const [params, setParams] = useSearchParams()
  /* TWO MODES (2026-10-14, the user's request: evaluators did not see that a
     learner could be opened). The page opens on a table of the learners in
     the round - the list. Selecting one opens the station: the form, the
     growth charts and the queue, as before. "Back to list" returns, and so
     does finishing the last learner. Arriving with ?learner= opens the
     station directly. */
  const [station, setStation] = useState(() => Boolean(params.get('learner')))
  const [q, setQ] = useState('')
  /* The grade the queue is narrowed to. */
  const [grade, setGrade] = useState('all')

  /* The learner's own record, opened over the station rather than by leaving. */
  const [profileOf, setProfileOf] = useState<{ learner: Learner; tab: 'overview' | 'growth' } | null>(null)
  /* The follow-up weigh-in dialogs. */
  const [starting, setStarting] = useState(false)
  const [ending, setEnding] = useState(false)
  /* Opens on Up next, or on Done when nobody is left to measure. The
     records are already loaded when a screen mounts (see Shell). */
  const [view, setView] = useState<'next' | 'done' | 'absent'>(() =>
    learners.some((l) => !inRound(l.measuredOn, currentRound()) && !absentIds.has(l.id)) ? 'next' : 'done',
  )

  /* The current round - baseline or endline (lib/rounds.ts). A learner is
     done once they have a measurement dated inside it, so the queue fills
     again by itself when the next round begins. Derived from what is
     recorded, so re-opening the app resumes where it left off. */
  const round = useMemo(() => currentRound(), [])
  /* A follow-up weigh-in in progress (2026-10-11) narrows the station to its
     learners, and counts a learner done once measured on or after the day it
     started. Ending it returns the station to the round above. */
  const followSet = useMemo(() => (followUp ? new Set(followUp.learnerIds) : null), [followUp])
  const inSection = useMemo(() => (followSet ? learners.filter((l) => followSet.has(l.id)) : learners), [learners, followSet])
  const done = (l: Learner) =>
    followUp ? Boolean(l.measuredOn && l.measuredOn >= followUp.startedOn) : inRound(l.measuredOn, round)
  const queue = useMemo(() => inSection.filter((l) => !done(l) && !absentIds.has(l.id)), [inSection, absentIds, round, followUp])
  const recorded = useMemo(() => inSection.filter((l) => done(l)), [inSection, round, followUp])
  const absent = useMemo(() => inSection.filter((l) => !done(l) && absentIds.has(l.id)), [inSection, absentIds, round, followUp])

  /* The order learners are taken in when nobody is picked: the order of the
     list on screen - by surname, within the chosen grade - so the learner
     marked "Next" is the one Save and next opens. */
  const inLine = useMemo(
    () => queue.filter((l) => grade === 'all' || l.section === grade).sort(bySurname),
    [queue, grade],
  )

  const currentLearner = useMemo(
    () => inSection.find((l) => l.id === activeId) ?? inLine[0] ?? queue[0] ?? null,
    [inSection, activeId, inLine, queue],
  )
  const total = inSection.length
  /* TWO KINDS OF SAVE for a learner who already has a measurement.

       New measurement   a fresh reading dated today. The earlier one stays
                         in the growth history. This is a re-weigh.
       Correction        fixes the figures of the latest measurement, keeping
                         its date. The figures it replaces are kept in the
                         measurement history.

     Measurements are one per learner per day, so a learner already measured
     TODAY can only be corrected. The choice is offered only when the latest
     reading is from an earlier date, and defaults to a new measurement. */
  /* MEASURING ON: the date every new measurement and absence is saved
     with. Today unless the nurse changes it - for instance to type in a
     class she weighed on paper yesterday. It stays as set until changed back
     or the screen is left, and it is shown wherever a save is confirmed. */
  const [sessionDate, setSessionDate] = useState(TODAY)
  const [editingDate, setEditingDate] = useState(false)
  const isToday = sessionDate === TODAY
  const sessionLabel = isToday ? `Today, ${formatDate(TODAY)}` : formatDate(sessionDate)

  const lastOn = currentLearner?.measuredOn ?? null
  const measuredToday = lastOn === sessionDate
  const [mode, setMode] = useState<'new' | 'correct'>('new')
  const correcting = Boolean(lastOn) && (measuredToday || mode === 'correct')
  /* A correction replaces figures already saved, so it asks first
     (2026-10-13). A new measurement saves straight away; its toast has Undo. */
  const [confirmCorrection, setConfirmCorrection] = useState(false)
  const targetDate = correcting && lastOn ? lastOn : sessionDate

  const loadedId = useRef<string | null>(null)

  /* ?learner=<id> puts a specific child on the scale; consumed once. */
  useEffect(() => {
    const want = params.get('learner')
    if (!want) return
    setActiveId(want)
    setStation(true)
    loadedId.current = null
    const next = new URLSearchParams(params)
    next.delete('learner')
    setParams(next, { replace: true })
  }, [params, setParams])

  /* Load whoever is on the scale into the fields, keyed on the id. */
  useEffect(() => {
    if (!currentLearner) {
      loadedId.current = null
      return
    }
    if (loadedId.current === currentLearner.id) return
    loadedId.current = currentLearner.id
    const sameDay = currentLearner.measuredOn === sessionDate
    /* A learner already measured in this round opens on that entry, to fix
       it; "+ New" starts a fresh one (2026-10-14, the user's request). A
       learner not yet measured this round always starts a new measurement:
       opening them on last round's figures would invite overwriting them. */
    const start = done(currentLearner) && currentLearner.measuredOn ? 'correct' : 'new'
    setMode(start)
    fill(sameDay ? 'correct' : start)
    heightRef.current?.focus()
    // fill() reads currentLearner, which is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLearner])

  /* A correction starts from the figures being corrected; a new measurement
     starts empty, so yesterday's numbers are never saved as today's by
     accident. */
  function fill(m: 'new' | 'correct') {
    if (!currentLearner) return
    if (m === 'correct' && currentLearner.measuredOn) {
      setHeight(currentLearner.heightCm !== null ? String(currentLearner.heightCm) : '')
      setWeight(currentLearner.weightKg !== null ? String(currentLearner.weightKg) : '')
      setNote(currentLearner.measurementNote ?? '')
    } else {
      setHeight('')
      setWeight('')
      setNote('')
    }
  }

  function chooseMode(m: 'new' | 'correct') {
    setMode(m)
    fill(m)
    heightRef.current?.focus()
  }

  const h = parseFloat(height)
  const w = parseFloat(weight)
  const heightOk = h > 60 && h < 200
  const weightOk = w > 8 && w < 150
  const valid = heightOk && weightOk

  /* Each field says what it accepts, but only once something is typed. */
  const heightError = height.trim() !== '' && !heightOk ? 'Between 60 and 200 cm' : null
  const weightError = weight.trim() !== '' && !weightOk ? 'Between 8 and 150 kg' : null

  /* The WHO 2007 engine, at this learner's age on the date of the
     measurement - the original date when correcting. */
  const preview = valid && currentLearner ? assess(w, h, currentLearner.birthDate, targetDate, currentLearner.sex) : null
  const previewBmi = preview?.bmi ?? null
  const previewZ = preview?.bmiZ ?? null
  const previewBand = preview?.bmiBand ?? null

  /* Height-for-age needs the height only, so it answers one field early. */
  const ageMonths = currentLearner ? ageInMonths(currentLearner.birthDate, targetDate) : null
  const hfaZ = currentLearner && heightOk && ageMonths !== null ? zHeightForAge(h, ageMonths, currentLearner.sex) : null
  const hfaBand = hfaZ === null ? null : classifyHeightForAge(hfaZ)

  // Plausibility guard: flags a probable mistyped digit before it is saved.
  const suspicious = preview?.outOfRange
    ? 'The learner’s age is outside the WHO reference range (5 to 19 years), so a nutritional status cannot be given. Check the date of birth.'
    : valid && previewZ !== null && Math.abs(previewZ) > 4
      ? 'Value is outside the expected range. Check the reading.'
      : null

  function save() {
    if (!currentLearner || !valid) return
    clearError()
    record(currentLearner.id, h, w, targetDate, note.trim())
    /* The confirmation, with an Undo that reverses exactly this save:
       removes a new measurement, or puts back the figures a correction
       replaced. */
    const who = currentLearner
    const on = targetDate
    const previous =
      correcting && who.heightCm !== null && who.weightKg !== null
        ? { heightCm: who.heightCm, weightKg: who.weightKg, note: who.measurementNote ?? '' }
        : null
    toast.success(
      `${previous ? 'Correction saved' : 'Measurement saved'} for ${who.firstName} ${who.lastName}, dated ${formatDate(on)}.`,
      {
        label: 'Undo',
        onClick: () => {
          if (previous) record(who.id, previous.heightCm, previous.weightKg, on, previous.note)
          else unrecord(who.id, on)
          toast.info(`Measurement removed for ${who.firstName} ${who.lastName}.`)
        },
      },
    )
    setActiveId(null)
    setHeight('')
    setWeight('')
    setNote('')
    loadedId.current = null
    heightRef.current?.focus()
  }


  function pick(id: string) {
    setActiveId(id)
    loadedId.current = null
  }

  /* From the table: put this learner on the scale and open the station. */
  function open(id: string) {
    pick(id)
    setStation(true)
  }

  function backToList() {
    setStation(false)
    setActiveId(null)
    setHeight('')
    setWeight('')
    setNote('')
    loadedId.current = null
  }

  /* Nobody left to put on the scale - the last learner was just saved, or
     the grade has none to measure - so the station has nothing to show. */
  useEffect(() => {
    if (station && !currentLearner) setStation(false)
  }, [station, currentLearner])

  function nextLearner() {
    setActiveId(null)
    setHeight('')
    setWeight('')
    setNote('')
    loadedId.current = null
    heightRef.current?.focus()
  }


  /* The list: To measure, Measured or Absent, narrowed by grade and by a
     search. A learner leaves "To measure" the moment they are saved. The
     counts on the tabs follow the grade filter. */
  /* Every class the school has, empty ones included; during a follow-up
     weigh-in, only the classes of the learners chosen for it. */
  const { classes } = useSchoolInfo()
  const grades = useMemo(
    () => classNames(followSet ? [] : classes, inSection).map((c) => c.name),
    [classes, followSet, inSection],
  )
  const needle = q.trim().toLowerCase()
  const inGrade = (l: Learner) => grade === 'all' || l.section === grade
  const hit = (l: Learner) => inGrade(l) && (!needle || fullName(l).toLowerCase().includes(needle) || l.lrn.includes(needle))
  const shown = (view === 'next' ? queue : view === 'done' ? recorded : absent).filter(hit).slice().sort(bySurname)

  const lists: { key: typeof view; label: string; n: number }[] = [
    { key: 'next', label: 'To measure', n: queue.filter(inGrade).length },
    { key: 'done', label: 'Measured', n: recorded.filter(inGrade).length },
    { key: 'absent', label: 'Absent', n: absent.filter(inGrade).length },
  ]

  /* Today's reading while it is valid and not yet saved: the growth chart
     places it beside the learner's earlier measurements. */
  const pending = useMemo<PendingReading | null>(() => {
    if (!valid || !currentLearner) return null
    /* Editing the last entry opens on its saved figures; until one changes
       there is nothing unsaved to plot. */
    if (correcting && h === currentLearner.heightCm && w === currentLearner.weightKg) return null
    return { heightCm: h, weightKg: w, on: targetDate }
  }, [valid, currentLearner, correcting, h, w, targetDate])

  /* The measurement this one is compared with - the latest saved one, or,
     when that is the one being corrected, the one from the year before. */
  const reference = useMemo(() => {
    if (!currentLearner) return null
    const l = currentLearner
    if (!correcting && l.measuredOn && l.heightCm !== null && l.weightKg !== null) {
      return { on: l.measuredOn, heightCm: l.heightCm, weightKg: l.weightKg, bmiBand: l.bmiBand, hfaBand: l.hfaBand }
    }
    if (l.previous) {
      const a = assess(l.previous.weightKg, l.previous.heightCm, l.birthDate, l.previous.measuredOn, l.sex)
      return { on: l.previous.measuredOn, ...l.previous, bmiBand: a.bmiBand, hfaBand: a.hfaBand }
    }
    return null
  }, [currentLearner, correcting])

  const since = reference ? new Date(`${reference.on}T00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : ''
  const heightNote = heightOk && reference ? `${signedFixed(h - reference.heightCm)} cm since ${since}` : null
  const weightNote = weightOk && reference ? `${signedFixed(w - reference.weightKg)} kg since ${since}` : null
  const newStatus = preview ? statusOf(previewBand, hfaBand) : null
  const oldStatus = reference ? statusOf(reference.bmiBand, reference.hfaBand) : null
  const statusChanged = newStatus !== null && oldStatus !== null && newStatus !== oldStatus
  const flaggedNow = Boolean(newStatus && newStatus !== 'Normal')

  /* The first learner in "To measure" who is not already on the scale: the
     one Save and next moves to. */
  const nextUp = inLine.find((l) => l.id !== currentLearner?.id) ?? null

  /* The queue: three tabs - To measure, Measured, Absent - and the list. It
     has the left column to itself; the learner picked from it opens in the
     right one. */
  /* Which weigh-in the list is for, and the way into or out of a follow-up
     weigh-in. Shared by the table and the station's queue. */
  const roundBar = (
      <div
        className={cx(
          'mb-2 flex shrink-0 items-center justify-between gap-2 rounded-[10px] text-[11.5px]',
          followUp ? 'bg-navy-50 px-3 py-2' : 'px-0.5',
        )}
      >
        <span className="min-w-0 truncate text-muted">
          {followUp ? (
            <>
              <span className="font-semibold text-navy-900">Follow-up weigh-in</span> · {inSection.length} learner
              {inSection.length === 1 ? '' : 's'}
            </>
          ) : (
            <>
              <span className="font-semibold text-navy-900">{round.label}</span> · {formatRange(round.from, round.to)}
            </>
          )}
        </span>
        <button
          type="button"
          onClick={() => (followUp ? setEnding(true) : setStarting(true))}
          className="shrink-0 font-semibold text-navy-700 underline-offset-2 hover:underline"
        >
          {followUp ? 'End' : 'Start follow-up'}
        </button>
      </div>
  )

  const tabsBar = (
      <div role="tablist" aria-label="Learners" className="grid shrink-0 grid-cols-3 gap-1">
        {lists.map((v) => {
          const on = view === v.key
          return (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setView(v.key)}
              className={cx(PILL, 'h-9 px-2 text-[12px]', on ? PILL_ON : PILL_OFF)}
            >
              {v.label}
              <span className="tnum opacity-70">{v.n}</span>
            </button>
          )
        })}
      </div>
  )

  /* What the empty list says, in the table and in the queue alike. */
  const emptyText = needle
    ? `No one matches “${q}”.`
    : view === 'next'
      ? 'No learners left to measure.'
      : view === 'absent'
        ? 'No learners marked absent.'
        : 'No measurements this round.'

  /* Everyone in the round (within the grade) has been measured. */
  const allMeasured = total > 0 && queue.filter(inGrade).length === 0 && absent.filter(inGrade).length === 0

  const queuePanel = (
    <>
      {roundBar}
      {tabsBar}

      <ul className="-mx-1 mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1">
        {shown.length === 0 && (
          <li className="px-2 py-6 text-center text-[12px] text-muted">{emptyText}</li>
        )}
        {shown.map((l) => {
          const active = currentLearner?.id === l.id
          const isNext = nextUp?.id === l.id
          const isAbsent = !done(l) && absentIds.has(l.id)
          const band = done(l) && l.measuredOn ? ([l.bmiBand, l.hfaBand].find((b) => b && b !== 'Normal') ?? 'Normal') : null
          return (
            <li key={l.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => pick(l.id)}
                aria-current={active ? 'true' : undefined}
                /* Rows read as actions, not a report (2026-10-14: evaluators did
                   not see that a measured learner could be opened again). A
                   hand cursor, a hover wash, and a Measure / Re-measure pill
                   on every row say it before anyone has to guess. */
                title={done(l) ? `Re-measure or correct ${l.firstName} ${l.lastName}` : `Measure ${l.firstName} ${l.lastName}`}
                className={cx(
                  'group flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left transition-colors duration-100',
                  active ? 'bg-navy-50' : 'hover:bg-wash',
                )}
              >
                <span
                  className={cx(
                    'grid size-8 shrink-0 place-items-center rounded-[9px] text-[10.5px] font-bold',
                    active ? 'bg-navy-900 text-white' : 'bg-wash text-navy-700',
                  )}
                >
                  {l.firstName[0]}
                  {l.lastName[0]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-navy-900">
                    {l.lastName}, {l.firstName}
                  </span>
                  <span className="block truncate text-[10.5px] text-muted">
                    {l.section}
                    {done(l) && l.measuredOn ? ` · ${shortDate(l.measuredOn)}` : ''}
                  </span>
                  {/* Its own line: beside the date and the pill it was cut
                      to "Ob…" on a 1366-wide laptop. */}
                  {band && (
                    <span
                      className="block truncate text-[10.5px] font-semibold"
                      style={{ color: BAND_COLOR[band as keyof typeof BAND_COLOR] }}
                    >
                      {band}
                    </span>
                  )}
                </span>
                {active ? (
                  <span className="shrink-0 rounded-full bg-navy-900 px-2 py-0.5 text-[10px] font-bold text-white">On the scale</span>
                ) : (
                  <span
                    className={cx(
                      'inline-flex shrink-0 items-center gap-0.5 rounded-full py-1 pr-1.5 pl-2.5 text-[10.5px] font-semibold transition-colors duration-100',
                      isNext ? 'text-[#071539]' : 'bg-navy-50 text-navy-700 group-hover:bg-navy-800 group-hover:text-white',
                    )}
                    style={isNext ? { background: Y } : undefined}
                  >
                    {isNext ? 'Measure next' : done(l) ? 'Re-measure' : 'Measure'}
                    <CaretRight size={10} weight="bold" />
                  </span>
                )}
              </button>
              {isAbsent && (
                <button
                  type="button"
                  onClick={() => unrecord(l.id, sessionDate)}
                  title="Return to the measurement list"
                  aria-label={`Return ${l.firstName} ${l.lastName} to the measurement list`}
                  className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-wash text-muted hover:bg-navy-50 hover:text-navy-900"
                >
                  <ArrowCounterClockwise size={13} weight="bold" />
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-6 pt-1 pb-5">
      {/* --- Context: the date saves are made with, grade, search ---------- */}
      <section className="panel flex shrink-0 flex-wrap items-center gap-2 rounded-[16px] p-2">
        {station && (
          <button
            type="button"
            onClick={backToList}
            className="flex h-9 items-center gap-1.5 rounded-[10px] bg-navy-50 px-3 text-[12px] font-semibold text-navy-800 transition-colors duration-100 hover:bg-navy-100"
          >
            <ArrowLeft size={13} weight="bold" />
            Back to list
          </button>
        )}
        {/* The date saves are made with. Shown only where saving happens -
            the station - not over the table (2026-10-14, the user's request). */}
        {station && (
        <span
          className={cx(
            'flex h-9 items-center gap-2 rounded-[10px] px-3 text-[12px]',
            isToday ? 'bg-wash text-navy-900' : 'bg-gold-100 text-gold-700',
          )}
        >
          <CalendarBlank size={14} weight="fill" className="shrink-0 text-navy-600" />
          <span>
            Measuring on <span className="font-semibold">{sessionLabel}</span>
          </span>
          {editingDate ? (
            <input
              type="date"
              autoFocus
              value={sessionDate}
              max={TODAY}
              min={`${schoolYearStart()}-06-01`}
              aria-label="Measuring on"
              onChange={(e) => {
                if (e.target.value && e.target.value <= TODAY) setSessionDate(e.target.value)
              }}
              onBlur={() => setEditingDate(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') setEditingDate(false)
              }}
              className="h-7 rounded-[8px] border border-line bg-white px-2 text-[12px] text-navy-900"
            />
          ) : (
            <button type="button" onClick={() => setEditingDate(true)} className="font-semibold text-navy-700 underline-offset-2 hover:underline">
              Change
            </button>
          )}
          {!isToday && !editingDate && (
            <button type="button" onClick={() => setSessionDate(TODAY)} className="font-semibold underline-offset-2 hover:underline">
              Back to today
            </button>
          )}
        </span>
        )}

        <span className="flex-1" />
        <Select
          label="Grade"
          value={grade}
          onValueChange={setGrade}
          options={[{ value: 'all', label: 'All grades' }, ...grades.map((g) => ({ value: g, label: g }))]}
        />
        <label className="relative block w-[200px]">
          <MagnifyingGlass size={13} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-placeholder" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a learner"
            aria-label="Find a learner by name or LRN"
            className="h-9 w-full rounded-[10px] bg-wash pr-8 pl-8 text-[12px] text-ink placeholder:text-placeholder focus:bg-white focus:shadow-[inset_0_0_0_1px_var(--color-navy-600),0_0_0_3px_rgba(43,82,196,0.14)] focus:outline-none"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ('')}
              aria-label="Clear search"
              className="absolute top-1/2 right-2 grid size-5 -translate-y-1/2 place-items-center rounded-full text-placeholder hover:bg-navy-50 hover:text-navy-900"
            >
              <X size={11} weight="bold" />
            </button>
          )}
        </label>
      </section>

      {!station ? (
        <LearnerTable
          rows={shown}
          done={done}
          emptyText={emptyText}
          roundBar={roundBar}
          tabsBar={tabsBar}
          allMeasured={allMeasured && view === 'next'}
          allMeasuredText={
            followUp
              ? 'Every learner in the follow-up weigh-in has a measurement.'
              : `Every learner${grade === 'all' ? '' : ` in ${grade}`} has a measurement for the ${round.key} round.`
          }
          onOpen={open}
          onSlips={() => navigate('/slips')}
          onShowMeasured={() => setView('done')}
        />
      ) : (
      /* --- The learner on the scale on the left; the queue on the right --
          (moved to the right 2026-10-13, the user's request) */
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(290px,330px)]">
        {currentLearner ? (
          <div className="flex min-h-0 flex-col gap-3">
            <form
              className="panel flex shrink-0 flex-col gap-3 rounded-[20px] px-5 py-4"
              onSubmit={(e) => {
                e.preventDefault()
                if (!valid) return
                if (correcting) setConfirmCorrection(true)
                else save()
              }}
            >
              <div className="flex items-center gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-navy-900 font-display text-[14px] font-semibold text-white">
                  {currentLearner.firstName[0]}
                  {currentLearner.lastName[0]}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-display text-[16px] leading-tight font-semibold text-navy-900">
                    {currentLearner.lastName}, {currentLearner.firstName}
                  </h2>
                  <div className="tnum truncate text-[11.5px] text-muted">
                    {currentLearner.section} · {currentLearner.sex === 'M' ? 'Male' : 'Female'} ·{' '}
                    {formatAge(ageInMonths(currentLearner.birthDate, TODAY))}
                    {correcting && lastOn && ` · Last measured ${formatDate(lastOn)}`}
                  </div>
                </div>
                {/* Editing the last entry: one button to start a new one
                    instead. A new one: a badge that says so, with × back to
                    the last entry. Nothing when there is no choice to make -
                    no earlier entry, or already measured on this date. */}
                {lastOn && !measuredToday && done(currentLearner) && (
                  mode === 'correct' ? (
                    <button
                      type="button"
                      onClick={() => chooseMode('new')}
                      className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-navy-50 px-3 text-[12px] font-semibold text-navy-700 transition-colors duration-100 hover:bg-navy-800 hover:text-white"
                    >
                      <Plus size={12} weight="bold" />
                      New
                    </button>
                  ) : (
                    <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-navy-800 pr-1 pl-3 text-[12px] font-semibold text-white">
                      <Plus size={12} weight="bold" />
                      New measurement · {isToday ? 'today' : formatDate(sessionDate)}
                      <button
                        type="button"
                        onClick={() => chooseMode('correct')}
                        aria-label="Cancel the new measurement and show the last entry"
                        title="Back to the last entry"
                        className="grid size-6 place-items-center rounded-full hover:bg-white/15"
                      >
                        <X size={11} weight="bold" />
                      </button>
                    </span>
                  )
                )}
                <IconButton label="Open record" onClick={() => setProfileOf({ learner: currentLearner, tab: 'overview' })}>
                  <User size={14} weight="bold" />
                </IconButton>
              </div>
  
              {measuredToday && (
                <p className="rounded-[10px] bg-wash px-3 py-2 text-[11.5px] leading-snug text-muted">
                  Measured on {isToday ? 'today' : formatDate(sessionDate)}. Saving replaces these figures; previous figures are kept on
                  record.
                </p>
              )}
  
              {/* The two fields and, beside them, what they come to. */}
              <div className="grid gap-2.5 xl:grid-cols-2">
                <div className="grid grid-cols-2 gap-2.5">
                  <Field
                    ref={heightRef}
                    label="Height"
                    unit="cm"
                    value={height}
                    onChange={setHeight}
                    error={heightError}
                    note={heightNote}
                    autoFocus
                  />
                  <Field label="Weight" unit="kg" value={weight} onChange={setWeight} error={weightError} note={weightNote} />
                </div>
                <Result bmiBand={previewBand} bmiValue={previewBmi} bmiZ={previewZ} hfaBand={hfaBand} hfaZ={hfaZ} />
              </div>
  
              <label className="block rounded-[14px] bg-wash px-3 pt-2 pb-2 transition-[background,box-shadow] duration-100 focus-within:bg-white focus-within:shadow-[inset_0_0_0_2px_var(--color-navy-600),0_0_0_4px_rgba(43,82,196,0.12)]">
                <span className="flex items-baseline justify-between text-[11px] font-semibold text-navy-900">
                  Note <span className="font-normal text-muted">Optional</span>
                </span>
                <input
                  value={note}
                  maxLength={300}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="For example: recovering from illness, weight loss expected"
                  className="mt-0.5 w-full bg-transparent text-[13px] text-navy-900 placeholder:text-[#a9b6c9] focus:outline-none"
                />
              </label>

              {suspicious && (
                <Alert tone="error">{suspicious}</Alert>
              )}
              {!suspicious && statusChanged && (
                <Alert tone="warn">
                  Changed from {oldStatus} to {newStatus} since the last measurement.
                  {flaggedNow && !correcting ? ' Invite the parent after saving.' : ''}
                </Alert>
              )}
  
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="submit"
                  disabled={!valid}
                  className={cx(
                    'flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-[12px] px-4 text-[13.5px] font-bold',
                    'transition-[filter,transform] duration-100 active:translate-y-px',
                    'disabled:cursor-not-allowed disabled:bg-wash disabled:text-placeholder',
                    'text-[#071539] hover:brightness-95',
                  )}
                  style={valid ? { background: Y } : undefined}
                >
                  <span className="truncate">{correcting ? 'Save changes' : 'Save and next'}</span>
                  <ArrowRight size={14} weight="bold" className="shrink-0" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    skip(currentLearner.id, sessionDate)
                    toast.info(`${currentLearner.firstName} ${currentLearner.lastName} marked absent on ${formatDate(sessionDate)}.`)
                    nextLearner()
                  }}
                  className="h-11 shrink-0 rounded-[12px] bg-wash px-5 text-[13px] font-semibold text-navy-900 transition-colors duration-100 hover:bg-navy-50"
                >
                  Absent
                </button>
              </div>
            </form>
  
            <GrowthPanel learner={currentLearner} pending={pending} />
          </div>
        ) : (
          <section className="panel flex min-h-0 flex-col items-center justify-center gap-3 rounded-[20px] px-8 py-10 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-[#e6f4ec]">
              <CheckCircle size={24} weight="fill" className="text-[var(--color-n)]" />
            </span>
            <h2 className="text-[16px] font-semibold text-navy-900">
              {total === 0
                ? 'No learners registered'
                : followUp
                  ? 'All learners in the follow-up weigh-in have been measured'
                  : `All learners measured for the ${round.key} round`}
            </h2>
            <p className="max-w-[46ch] text-[12.5px] leading-relaxed text-muted">
              {total === 0
                ? 'Add learners on the Learners page.'
                : `${absent.length > 0 ? `${absent.length} learner${absent.length === 1 ? ' was' : 's were'} marked absent. ` : ''}${followUp ? `End the follow-up weigh-in to return to the ${round.label.toLowerCase()}.` : 'To re-measure or correct a learner, select the learner from the list.'}`}
            </p>
            {total > 0 && (
              <div className="mt-1 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => navigate('/slips')}
                  className="h-9 rounded-full px-4 text-[12.5px] font-semibold text-[#071539] transition-[filter] duration-100 hover:brightness-95"
                  style={{ background: Y }}
                >
                  Print invitation slips
                </button>
              </div>
            )}
          </section>
        )}

        <section className="panel flex min-h-0 flex-col rounded-[20px] px-4 py-4" aria-label="Learners">
          {queuePanel}
        </section>
      </div>
      )}


      {currentLearner && (
        <ConfirmDialog
          open={confirmCorrection}
          onOpenChange={setConfirmCorrection}
          title="Replace the saved measurement?"
          body={
            <>
              {currentLearner.firstName} {currentLearner.lastName}, {formatDate(lastOn ?? targetDate)}: height{' '}
              <span className="tnum font-semibold text-navy-900">
                {currentLearner.heightCm?.toFixed(1) ?? '–'} → {h.toFixed(1)} cm
              </span>
              , weight{' '}
              <span className="tnum font-semibold text-navy-900">
                {currentLearner.weightKg?.toFixed(1) ?? '–'} → {w.toFixed(1)} kg
              </span>
              . The earlier figures are kept in the record's history.
            </>
          }
          confirmLabel="Save changes"
          onConfirm={() => {
            setConfirmCorrection(false)
            save()
          }}
        />
      )}

      <StartFollowUpDialog
        open={starting}
        onOpenChange={setStarting}
        learners={learners}
        onStart={(f) => {
          startFollowUp(f)
          setStarting(false)
          setView('next')
          nextLearner()
          toast.success(`Follow-up weigh-in started for ${f.learnerIds.length} learner${f.learnerIds.length === 1 ? '' : 's'}.`)
        }}
      />
      <EndFollowUpDialog
        open={ending}
        onOpenChange={setEnding}
        measured={recorded.length}
        total={inSection.length}
        onEnd={() => {
          endFollowUp()
          setEnding(false)
          nextLearner()
          toast.info('Follow-up weigh-in ended.')
        }}
      />

      <Modal open={profileOf !== null} onOpenChange={(o) => !o && setProfileOf(null)}>
        {profileOf && (
          <LearnerRecordDialog
            learner={profileOf.learner}
            initialTab={profileOf.tab}
            onWeighIn={(id) => {
              open(id)
              setProfileOf(null)
            }}
            onSlips={(id) => navigate(`/slips?learner=${encodeURIComponent(id)}`)}
            onSaved={() => undefined}
          />
        )}
      </Modal>
    </div>
  )
}

const bySurname = (a: Learner, b: Learner) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)

/* --- Small parts ------------------------------------------------------------- */

const signedFixed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}`

/** "Normal", or the bands off normal: "Wasted and Stunted". */
function statusOf(bmiBand: string | null, hfaBand: string | null): string {
  const off = [bmiBand, hfaBand].filter((b): b is string => Boolean(b && b !== 'Normal'))
  return off.length ? off.join(' and ') : 'Normal'
}


function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-wash text-navy-700 transition-colors duration-100 hover:bg-navy-50"
    >
      {children}
    </button>
  )
}

function Alert({ tone, children }: { tone: 'warn' | 'error'; children: ReactNode }) {
  return (
    <p
      className={cx(
        'flex items-start gap-2 rounded-[12px] px-3 py-2 text-[11.5px] leading-snug',
        tone === 'error' ? 'bg-[#fdf2f5] text-[#9f1239]' : 'bg-[#fff6ec] text-[#8a4a1f]',
      )}
    >
      <Warning size={14} weight="fill" className={cx('mt-px shrink-0', tone === 'error' ? 'text-[#9f1239]' : 'text-[var(--color-w)]')} />
      <span>{children}</span>
    </p>
  )
}

/* --- The result, on the WHO scale --------------------------------------------
   The verdict in words and colour, the BMI-for-age z-score as a marker on
   the band scale (drawn from the same cut-off table that classifies it), and
   height-for-age underneath. It keeps its size before there is an answer, so
   nothing moves while the digits are typed. */

function Result({
  bmiBand,
  bmiValue,
  bmiZ,
  hfaBand,
  hfaZ,
}: {
  bmiBand: string | null
  bmiValue: number | null
  bmiZ: number | null
  hfaBand: string | null
  hfaZ: number | null
}) {
  const color = (b: string | null) => (b ? BAND_COLOR[b as keyof typeof BAND_COLOR] : 'var(--color-placeholder)')
  return (
    <section
      className="flex flex-col justify-center rounded-[14px] px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--color-line)]"
      aria-live="polite"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-display text-[18px] leading-tight font-semibold" style={{ color: color(bmiBand) }}>
          {bmiBand ?? 'Waiting'}
        </span>
        <span className="tnum text-[11.5px] text-muted">
          {bmiBand ? (
            <>
              BMI <span className="font-semibold text-navy-900">{bmiValue?.toFixed(1)}</span> · z{' '}
              <span className="font-semibold text-navy-900">{bmiZ === null ? '–' : signedFixed(bmiZ)}</span>
            </>
          ) : (
            'Enter height and weight'
          )}
        </span>
      </div>
      <WhoScale z={bmiZ} cutoffs={BMI_CUTOFFS} />
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
        <span>BMI-for-age</span>
        <span>
          Height-for-age{' '}
          <span className="font-semibold" style={{ color: color(hfaBand) }}>
            {hfaBand ? `${hfaBand} · z ${hfaZ === null ? '–' : signedFixed(hfaZ)}` : 'pending'}
          </span>
        </span>
      </div>
    </section>
  )
}

/** A band scale from −4 to +4 with a marker at the learner's z-score. */
function WhoScale({ z, cutoffs }: { z: number | null; cutoffs: { band: string; min: number; max: number }[] }) {
  const LO = -4
  const HI = 4
  const segs = cutoffs
    .map((c) => ({ band: c.band, from: Math.max(c.min, LO), to: Math.min(c.max, HI) }))
    .filter((s) => s.to > s.from)
  const at = z === null ? null : ((Math.min(HI, Math.max(LO, z)) - LO) / (HI - LO)) * 100
  return (
    <div className="relative mt-2.5" role="img" aria-label={z === null ? 'No z-score yet' : `BMI-for-age z-score ${signedFixed(z)}`}>
      <div className="flex h-2 gap-[2px] overflow-hidden rounded-full">
        {segs.map((s) => (
          <span
            key={s.band}
            title={s.band}
            style={{
              flex: s.to - s.from,
              background: `color-mix(in srgb, ${BAND_COLOR[s.band as keyof typeof BAND_COLOR]} ${s.band === 'Normal' ? 30 : 38}%, white)`,
            }}
          />
        ))}
      </div>
      {at !== null && (
        <span
          className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-navy-900 shadow-[0_0_0_3px_#fff,0_2px_6px_rgba(14,36,100,0.35)] transition-[left] duration-200 ease-[var(--ease-chas)]"
          style={{ left: `${at}%` }}
        />
      )}
    </div>
  )
}

/* --- The number fields ------------------------------------------------------
   Large, legible at arm's length from a stadiometer. Under the number, the
   change since the last measurement, or - with the accepted range - what is
   wrong with the entry. That line holds its space either way. */

const Field = forwardRef<
  HTMLInputElement,
  {
    label: string
    unit: string
    value: string
    onChange: (v: string) => void
    error?: string | null
    note?: string | null
    autoFocus?: boolean
  }
>(function Field({ label, unit, value, onChange, error, note, autoFocus }, ref) {
  return (
    <label
      className={cx(
        'block rounded-[14px] px-3 pt-2 pb-2 transition-[background,box-shadow] duration-100',
        error
          ? 'bg-[#fdf2f5] shadow-[inset_0_0_0_1.5px_#9f1239]'
          : 'bg-wash focus-within:bg-white focus-within:shadow-[inset_0_0_0_2px_var(--color-navy-600),0_0_0_4px_rgba(43,82,196,0.12)]',
      )}
    >
      <span className="block text-[11px] font-semibold text-navy-900">{label}</span>
      <span className="flex items-baseline gap-1.5">
        <input
          ref={ref}
          autoFocus={autoFocus}
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0.0"
          aria-label={`${label} in ${unit === 'cm' ? 'centimetres' : 'kilograms'}`}
          aria-invalid={Boolean(error)}
          className="tnum w-full min-w-0 bg-transparent font-display text-[28px] leading-tight font-semibold tracking-[-0.03em] text-navy-900 placeholder:font-normal placeholder:text-[#c2cddd] focus:outline-none"
        />
        <span className="text-[12.5px] font-semibold text-muted">{unit}</span>
      </span>
      <span
        className={cx(
          'mt-0.5 inline-block max-w-full truncate rounded-full text-[10.5px] leading-[18px]',
          error ? 'font-medium text-[#9f1239]' : note ? 'bg-navy-50 px-2 font-semibold text-navy-700' : 'text-transparent select-none',
        )}
      >
        {error ?? note ?? ' '}
      </span>
    </label>
  )
})

/** "Aug 10", or "Aug 10, 2025" when it is not this year - room is short in the list. */
function shortDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00`)
  if (Number.isNaN(d.getTime())) return iso
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

/* --- The list: every learner in the round, as a table ------------------------
   What the page opens on (2026-10-14). The same tabs, grade and search as
   the station's queue; each row opens the station on that learner. When
   everyone is measured, the To measure list shows a one-line notice as its
   empty state - the way the SF8 page says it - instead of an empty card. */

const TABLE_HEAD = ['Learner', 'Grade', 'Sex', 'Age', 'Last measured', 'Height', 'Weight', 'Status', '']

function LearnerTable({
  rows,
  done,
  emptyText,
  roundBar,
  tabsBar,
  allMeasured,
  allMeasuredText,
  onOpen,
  onSlips,
  onShowMeasured,
}: {
  rows: Learner[]
  done: (l: Learner) => boolean
  emptyText: string
  roundBar: ReactNode
  tabsBar: ReactNode
  allMeasured: boolean
  allMeasuredText: string
  onOpen: (id: string) => void
  onSlips: () => void
  onShowMeasured: () => void
}) {
  return (
    <section className="panel flex min-h-0 flex-1 flex-col rounded-[20px] px-5 py-4" aria-label="Learners">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 flex-1 [&>div]:mb-0">{roundBar}</div>
        <div className="w-full max-w-[420px]">{tabsBar}</div>
      </div>


      {rows.length === 0 ? (
        /* An empty list is said in the middle of the panel, not in a strip
           under column headings for rows that are not there (2026-10-14). */
        <div className="flex min-h-[260px] flex-1 flex-col items-center justify-center px-6 py-10 text-center">
          {allMeasured ? (
            <>
              <span className="grid size-16 place-items-center rounded-full bg-[#e6f4ec] shadow-[0_0_0_8px_#f2faf5]">
                <CheckCircle size={30} weight="fill" className="text-[#1f8a4c]" />
              </span>
              <h3 className="mt-5 font-display text-[18px] font-bold tracking-[-0.01em] text-navy-900">All learners measured</h3>
              <p className="mt-1.5 max-w-[46ch] text-[12.5px] leading-relaxed text-muted">
                {allMeasuredText} To re-measure or correct a learner, open the measured list.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={onSlips}
                  className="h-10 rounded-full px-5 text-[12.5px] font-semibold text-[#071539] transition-[filter] duration-100 hover:brightness-95"
                  style={{ background: Y }}
                >
                  Print invitation slips
                </button>
                <button
                  type="button"
                  onClick={onShowMeasured}
                  className="h-10 rounded-full bg-wash px-5 text-[12.5px] font-semibold text-navy-900 transition-colors duration-100 hover:bg-navy-50"
                >
                  View measured learners
                </button>
              </div>
            </>
          ) : (
            <p className="text-[12.5px] text-muted">{emptyText}</p>
          )}
        </div>
      ) : (
      <div className="-mx-5 mt-3 min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[860px] border-collapse text-[12px]">
          <thead className="sticky top-0 z-10 bg-white">
            <tr className="border-b border-line-soft">
              {TABLE_HEAD.map((h, i) => (
                <th
                  key={h || 'action'}
                  scope="col"
                  className={cx(
                    'py-2.5 text-left text-[10.5px] font-semibold tracking-[0.05em] whitespace-nowrap text-placeholder uppercase',
                    i === 0 ? 'pr-2 pl-5' : i === TABLE_HEAD.length - 1 ? 'pr-5 pl-2' : 'px-2',
                    (h === 'Height' || h === 'Weight') && 'text-right',
                  )}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tnum">
            {rows.map((l) => {
              const measured = done(l) && l.measuredOn
              const band = measured ? ([l.bmiBand, l.hfaBand].find((b) => b && b !== 'Normal') ?? 'Normal') : null
              return (
                <tr
                  key={l.id}
                  onClick={() => onOpen(l.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(l.id)
                  }}
                  tabIndex={0}
                  title={done(l) ? `Re-measure or correct ${l.firstName} ${l.lastName}` : `Measure ${l.firstName} ${l.lastName}`}
                  className="group focus-ring cursor-pointer border-b border-line-soft transition-colors duration-100 last:border-b-0 hover:bg-wash focus-visible:outline-none"
                >
                  <td className="py-2 pr-2 pl-5">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-navy-50 text-[10.5px] font-bold text-navy-700">
                        {l.firstName[0]}
                        {l.lastName[0]}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-semibold whitespace-nowrap text-navy-900">
                          {l.lastName}, {l.firstName}
                        </span>
                        <span className="block font-mono text-[10.5px] text-muted">{l.lrn}</span>
                      </span>
                    </span>
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-navy-900">{l.section}</td>
                  <td className="px-2 py-2 text-muted">{l.sex}</td>
                  <td className="px-2 py-2 whitespace-nowrap text-navy-900">{formatAge(ageInMonths(l.birthDate, TODAY))}</td>
                  <td className="px-2 py-2 whitespace-nowrap text-navy-900">{l.measuredOn ? formatDate(l.measuredOn) : '–'}</td>
                  <td className="px-2 py-2 text-right whitespace-nowrap text-navy-900">
                    {l.heightCm === null ? '–' : `${l.heightCm.toFixed(1)} cm`}
                  </td>
                  <td className="px-2 py-2 text-right whitespace-nowrap text-navy-900">
                    {l.weightKg === null ? '–' : `${l.weightKg.toFixed(1)} kg`}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    {band ? (
                      <span className="font-semibold" style={{ color: BAND_COLOR[band as keyof typeof BAND_COLOR] }}>
                        {band}
                      </span>
                    ) : (
                      <span className="text-placeholder">Not measured</span>
                    )}
                  </td>
                  <td className="py-2 pr-5 pl-2 text-right">
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-navy-50 py-1 pr-1.5 pl-2.5 text-[11px] font-semibold whitespace-nowrap text-navy-700 transition-colors duration-100 group-hover:bg-navy-800 group-hover:text-white">
                      {done(l) ? 'Re-measure' : 'Measure'}
                      <CaretRight size={10} weight="bold" />
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      )}
    </section>
  )
}
