import { useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, GraduationCap, MagnifyingGlass, X } from '@phosphor-icons/react'
import { Modal, ModalCloseButton, ModalContent, ModalDescription, ModalTitle } from './primitives'
import { cx } from './ui'
import { Callout, Field, Initials, PrimaryButton, inputClass } from './SlipWizard'
import { fullName, type Learner } from '@/data/mock'
import { ApiError, endpoints, type ApiSchoolYear, type EnrolmentOutcome } from '@/lib/api'

/* Starting a new school year, opened from the School year page.

   The same narrow dialog as the slip wizard - one question per step, a thin
   progress bar on top:

   1. Which school year is next?     the label, filled in for her
   2. Who is not moving up?          everyone is promoted unless she says not
   3. Classes and advisers           where sections go, who advises them
   4. Ready to start                 the counts, and the year typed to confirm

   The dialog only collects and sends. The server does the whole change in
   one transaction (server/src/routes/school-year.ts). */

const OUTCOME_LABEL: Record<EnrolmentOutcome, string> = {
  PROMOTED: 'Promoted',
  RETAINED: 'Retained',
  COMPLETED: 'Completed',
  TRANSFERRED_OUT: 'Transferred out',
  DROPPED: 'Dropped',
}

type Step = 1 | 2 | 3 | 4

export default function RolloverWizard({
  open,
  onOpenChange,
  year,
  learners,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  year: ApiSchoolYear
  learners: Learner[]
  onDone: (toYear: string) => void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <Modal open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      {open && (
        <ModalContent className="max-h-[min(90vh,820px)] max-w-[600px]">
          <Wizard year={year} learners={learners} busy={busy} setBusy={setBusy} onDone={onDone} />
        </ModalContent>
      )}
    </Modal>
  )
}

function Wizard({
  year,
  learners,
  busy,
  setBusy,
  onDone,
}: {
  year: ApiSchoolYear
  learners: Learner[]
  busy: boolean
  setBusy: (b: boolean) => void
  onDone: (toYear: string) => void
}) {
  const [step, setStep] = useState<Step>(1)
  const [error, setError] = useState<string | null>(null)

  /* --- The school's shape ----------------------------------------------- */
  const top = year.grades.at(-1)?.level ?? 0
  const gradeName = (level: number) => year.grades.find((g) => g.level === level)?.name ?? `Grade ${level}`

  /* --- 1. The year -------------------------------------------------------- */
  const [toYear, setToYear] = useState(year.nextYear ?? '')
  const [tried, setTried] = useState(false)
  const yearError = (() => {
    const m = /^(\d{4})-(\d{4})$/.exec(toYear.trim())
    if (!m) return 'Write the school year as 2027-2028.'
    if (Number(m[2]) !== Number(m[1]) + 1) return 'The two years must follow each other.'
    if (Number(m[1]) <= Number(year.schoolYear.slice(0, 4))) return `It must come after ${year.schoolYear}.`
    return null
  })()

  /* --- 2. Outcomes --------------------------------------------------------
     The plain default is promoted, or completed in the last grade. A learner
     the school already marked as gone this year starts that way instead. */
  const plain = (l: Learner): EnrolmentOutcome => (l.gradeLevel === top ? 'COMPLETED' : 'PROMOTED')
  const [outcome, setOutcome] = useState<Record<string, EnrolmentOutcome>>(() => {
    const o: Record<string, EnrolmentOutcome> = {}
    for (const l of learners) o[l.id] = year.defaults[l.id] ?? plain(l)
    return o
  })
  const [grade, setGrade] = useState<number | null>(null)
  const [onlyChanged, setOnlyChanged] = useState(false)
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const sorted = useMemo(
    () => [...learners].sort((a, b) => a.gradeLevel - b.gradeLevel || fullName(a).localeCompare(fullName(b))),
    [learners],
  )
  const rows = sorted.filter(
    (l) =>
      (grade === null || l.gradeLevel === grade) &&
      (!onlyChanged || outcome[l.id] !== plain(l)) &&
      (!needle || fullName(l).toLowerCase().includes(needle) || l.lrn.includes(needle)),
  )
  const counts = useMemo(() => {
    const c: Record<EnrolmentOutcome, number> = { PROMOTED: 0, RETAINED: 0, COMPLETED: 0, TRANSFERRED_OUT: 0, DROPPED: 0 }
    for (const l of learners) c[outcome[l.id] ?? plain(l)]++
    return c
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learners, outcome])
  const changed = learners.filter((l) => outcome[l.id] !== plain(l)).length
  const grades = [...new Set(learners.map((l) => l.gradeLevel))].sort((a, b) => a - b)

  /* --- 3. Sections and advisers ------------------------------------------
     A section's promoted learners go to the next grade's section. Where the
     next grade has only one, there is nothing to ask. */
  const [sectionMap, setSectionMap] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {}
    for (const g of year.grades) {
      const next = year.grades.find((x) => x.level === g.level + 1)?.sections ?? []
      if (next.length > 1) for (const s of g.sections) m[s.id] = ''
    }
    return m
  })
  const needsMap = Object.keys(sectionMap)
  const mapMissing = needsMap.filter((id) => !sectionMap[id])
  const [advisers, setAdvisers] = useState<Record<string, string>>(() => {
    const a: Record<string, string> = {}
    for (const g of year.grades) for (const s of g.sections) a[s.id] = s.adviser
    return a
  })
  /* A grade with promoted learners and no next grade to go to. */
  const stranded = year.grades.filter(
    (g) =>
      g.level !== top &&
      !year.grades.some((x) => x.level === g.level + 1 && x.sections.length > 0) &&
      learners.some((l) => l.gradeLevel === g.level && outcome[l.id] === 'PROMOTED'),
  )

  /* --- 4. Confirm --------------------------------------------------------- */
  const [typed, setTyped] = useState('')
  const confirmed = typed.trim() === toYear.trim()

  async function start() {
    if (!confirmed || busy) return
    setBusy(true)
    setError(null)
    try {
      /* Only what differs from what the server would decide by itself. */
      const outcomes: Record<string, EnrolmentOutcome> = {}
      for (const l of learners) {
        const o = outcome[l.id]
        if (o !== plain(l) || year.defaults[l.id]) outcomes[l.id] = o
      }
      const changedAdvisers: Record<string, string> = {}
      for (const g of year.grades) {
        for (const s of g.sections) {
          const v = (advisers[s.id] ?? '').trim()
          if (v !== s.adviser) changedAdvisers[s.id] = v
        }
      }
      await endpoints.rollover({
        fromYear: year.schoolYear,
        toYear: toYear.trim(),
        outcomes,
        sectionMap: Object.fromEntries(Object.entries(sectionMap).filter(([, v]) => v)),
        advisers: changedAdvisers,
      })
      setBusy(false)
      onDone(toYear.trim())
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Unable to start the new school year.')
      setBusy(false)
    }
  }

  function next() {
    setError(null)
    if (step === 1) {
      setTried(true)
      if (!yearError) setStep(2)
    } else if (step === 2) {
      if (stranded.length === 0) setStep(3)
    } else if (step === 3) {
      if (mapMissing.length === 0) setStep(4)
    }
  }

  const head = {
    1: { title: 'New school year', sub: `Closes S.Y. ${year.schoolYear} and opens the next school year.` },
    2: {
      title: 'Learner status',
      sub: `All learners are promoted by default and ${gradeName(top)} learners are marked completed. Change only the exceptions.`,
    },
    3: { title: 'Classes and advisers', sub: `Class advisers for S.Y. ${toYear}.` },
    4: { title: `Confirm S.Y. ${toYear}`, sub: 'Review the summary, then type the school year to confirm.' },
  }[step]

  return (
    <>
      <header className="shrink-0 px-6 pt-5">
        <div className="flex gap-1.5" aria-hidden>
          {[1, 2, 3, 4].map((s) => (
            <span
              key={s}
              className={cx('h-1 flex-1 rounded-full transition-colors duration-200', s <= step ? 'bg-navy-600' : 'bg-line')}
            />
          ))}
        </div>
        <div className="mt-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11.5px] font-medium text-muted">Step {step} of 4</div>
            <ModalTitle className="mt-1 text-[19px] leading-tight font-semibold tracking-[-0.015em] text-navy-900">
              {head.title}
            </ModalTitle>
            <ModalDescription className="mt-1 text-[12.5px] leading-relaxed text-muted">{head.sub}</ModalDescription>
          </div>
          <ModalCloseButton label="Close" />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-6 pt-5 pb-2">
        {step === 1 && (
          <div className="space-y-4">
            <Field label="New school year" hint="Taong panuruan" error={tried ? yearError : null}>
              <input
                value={toYear}
                onChange={(e) => setToYear(e.target.value)}
                placeholder="2027-2028"
                inputMode="numeric"
                className={inputClass(Boolean(tried && yearError))}
              />
            </Field>
            <ul className="space-y-2 rounded-[14px] px-4 py-3.5 text-[12px] leading-relaxed text-ink shadow-[inset_0_0_0_1px_var(--color-line)]">
              <Point>Each learner is recorded as promoted, retained, completed, transferred out or dropped for S.Y. {year.schoolYear}.</Point>
              <Point>Promoted and retained learners are moved to their class for S.Y. {toYear || 'the new year'}. Other learners are removed from the roster; their records are kept.</Point>
              <Point>Weigh-ins, invitation slips and the parent meeting start over for the new school year. Previous records are kept.</Point>
              <Point>This can be undone until a record is saved in the new school year.</Point>
            </ul>
          </div>
        )}

        {step === 2 && (
          <div>
            <div className="flex flex-wrap gap-1.5">
              <Chip on={!onlyChanged && grade === null} onClick={() => { setGrade(null); setOnlyChanged(false) }}>
                All · {learners.length}
              </Chip>
              {grades.map((g) => (
                <Chip key={g} on={!onlyChanged && grade === g} onClick={() => { setGrade(g); setOnlyChanged(false) }}>
                  {gradeName(g)}
                </Chip>
              ))}
              <Chip on={onlyChanged} onClick={() => { setOnlyChanged(true); setGrade(null) }}>
                Not promoted · {changed}
              </Chip>
            </div>
            <label className="relative mt-3 block">
              <MagnifyingGlass size={13} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-placeholder" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name or LRN"
                aria-label="Search learners"
                className="h-8 w-full rounded-full bg-wash pr-7 pl-8 text-[12px] text-ink placeholder:text-placeholder focus:bg-white focus:shadow-[inset_0_0_0_1px_var(--color-navy-600)] focus:outline-none"
              />
              {q && (
                <button
                  type="button"
                  onClick={() => setQ('')}
                  aria-label="Clear search"
                  className="absolute top-1/2 right-2 grid size-5 -translate-y-1/2 place-items-center rounded-full text-placeholder hover:text-navy-900"
                >
                  <X size={11} weight="bold" />
                </button>
              )}
            </label>

            <ul className="mt-3 max-h-[360px] overflow-auto rounded-[14px] shadow-[inset_0_0_0_1px_var(--color-line)]">
              {rows.map((l) => {
                const o = outcome[l.id]
                const isTop = l.gradeLevel === top
                const options: EnrolmentOutcome[] = isTop
                  ? ['COMPLETED', 'RETAINED', 'TRANSFERRED_OUT', 'DROPPED']
                  : ['PROMOTED', 'RETAINED', 'TRANSFERRED_OUT', 'DROPPED']
                const differs = o !== plain(l)
                return (
                  <li key={l.id} className={cx('flex items-center gap-3 border-b border-line-soft px-4 py-2.5 last:border-b-0', differs && 'bg-gold-100/40')}>
                    <Initials l={l} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-navy-900">{fullName(l)}</span>
                      <span className="block truncate text-[11px] text-muted">{whereTo(l, o, gradeName)}</span>
                    </span>
                    <select
                      value={o}
                      onChange={(e) => setOutcome((m) => ({ ...m, [l.id]: e.target.value as EnrolmentOutcome }))}
                      aria-label={`Ending for ${fullName(l)}`}
                      className={cx(
                        'h-8 shrink-0 cursor-pointer rounded-full px-3 text-[11.5px] font-medium focus:outline-none focus:shadow-[0_0_0_3px_rgba(43,82,196,0.18)]',
                        differs ? 'bg-gold-100 text-gold-700' : 'bg-wash text-navy-800',
                      )}
                    >
                      {options.map((k) => (
                        <option key={k} value={k}>
                          {OUTCOME_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </li>
                )
              })}
              {rows.length === 0 && (
                <li className="px-4 py-10 text-center text-[12.5px] text-muted">
                  {onlyChanged && !needle ? 'All learners are promoted.' : 'No learners match.'}
                </li>
              )}
            </ul>
            <p className="tnum mt-3 text-[11.5px] text-muted">
              {counts.PROMOTED} promoted · {counts.COMPLETED} completed · {counts.RETAINED} retained ·{' '}
              {counts.TRANSFERRED_OUT + counts.DROPPED} removed
            </p>
            {stranded.length > 0 && (
              <div className="mt-3">
                <Callout tone="error">
                  {stranded.map((g) => g.name).join(', ')} has no next grade level. Add a section for the next grade level, or mark these learners as retained.
                </Callout>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            {year.grades.map((g) => {
              const next = year.grades.find((x) => x.level === g.level + 1)?.sections ?? []
              return (
                <section key={g.level}>
                  <h4 className="mb-1.5 text-[11.5px] font-semibold tracking-[0.02em] text-muted uppercase">{g.name}</h4>
                  <div className="divide-y divide-line-soft rounded-[14px] shadow-[inset_0_0_0_1px_var(--color-line)]">
                    {g.sections.map((s) => (
                      <div key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                        <span className="w-28 shrink-0 truncate text-[12.5px] font-medium text-navy-900">{s.name}</span>
                        <input
                          value={advisers[s.id] ?? ''}
                          onChange={(e) => setAdvisers((a) => ({ ...a, [s.id]: e.target.value }))}
                          placeholder="Adviser's name"
                          aria-label={`Adviser of ${s.name} for ${toYear}`}
                          className="h-9 min-w-[180px] flex-1 rounded-[10px] bg-white px-3 text-[12.5px] text-navy-900 shadow-[inset_0_0_0_1px_var(--color-line)] placeholder:text-placeholder focus:shadow-[inset_0_0_0_1.5px_var(--color-navy-600)] focus:outline-none"
                        />
                        {s.id in sectionMap && (
                          <label className="flex w-full items-center gap-2 text-[11.5px] text-muted">
                            Promoted learners go to
                            <select
                              value={sectionMap[s.id]}
                              onChange={(e) => setSectionMap((m) => ({ ...m, [s.id]: e.target.value }))}
                              className={cx(
                                'h-8 rounded-full px-3 text-[11.5px] font-medium focus:outline-none',
                                sectionMap[s.id] ? 'bg-wash text-navy-800' : 'bg-[#fdf2f5] text-[#9f1239]',
                              )}
                            >
                              <option value="">Choose a class</option>
                              {next.map((n) => (
                                <option key={n.id} value={n.id}>
                                  {n.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                      </div>
                    ))}
                    {g.sections.length === 0 && (
                      <div className="px-4 py-3 text-[12px] text-muted">No classes in this grade.</div>
                    )}
                  </div>
                </section>
              )
            })}
            {mapMissing.length > 0 && (
              <Callout tone="info">Select the destination section for each class.</Callout>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Count n={counts.PROMOTED} label="Promoted" />
              <Count n={counts.RETAINED} label="Retained" />
              <Count n={counts.COMPLETED} label={`Completed ${gradeName(top)}`} />
              <Count n={counts.TRANSFERRED_OUT + counts.DROPPED} label="Transferred out or dropped" />
            </div>
            <p className="text-[12px] leading-relaxed text-muted">
              {counts.PROMOTED + counts.RETAINED} learners will be enrolled in S.Y. {toYear}.{' '}
              {counts.COMPLETED + counts.TRANSFERRED_OUT + counts.DROPPED} will be removed from the roster; their records are kept.
              New Grade 1 learners and transferees are added from the Learners page.
            </p>
            <Field label={`Type ${toYear} to confirm`} hint="I-type para kumpirmahin" error={null}>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={toYear}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && void start()}
                className={inputClass(false)}
              />
            </Field>
            {error && <Callout tone="error">{error}</Callout>}
          </div>
        )}
      </div>

      <footer className="flex shrink-0 items-center gap-2 px-6 pt-3 pb-5">
        {step > 1 ? (
          <button
            type="button"
            onClick={() => setStep((step - 1) as Step)}
            disabled={busy}
            className="flex h-10 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium text-muted transition-colors duration-100 hover:bg-wash hover:text-navy-900 disabled:opacity-50"
          >
            <ArrowLeft size={13} weight="bold" />
            Back
          </button>
        ) : (
          <span />
        )}
        <span className="flex-1" />
        {step < 4 ? (
          <PrimaryButton
            onClick={next}
            disabled={(step === 2 && stranded.length > 0) || (step === 3 && mapMissing.length > 0)}
          >
            Continue
            <ArrowRight size={14} weight="bold" />
          </PrimaryButton>
        ) : (
          <PrimaryButton onClick={() => void start()} disabled={!confirmed || busy}>
            <GraduationCap size={15} weight="bold" />
            {busy ? 'Starting…' : `Start S.Y. ${toYear}`}
          </PrimaryButton>
        )}
      </footer>
    </>
  )
}

/* Where this learner will be, in words. */
function whereTo(l: Learner, o: EnrolmentOutcome, gradeName: (n: number) => string): string {
  const from = l.section
  switch (o) {
    case 'PROMOTED':
      return `${from} → ${gradeName(l.gradeLevel + 1)}`
    case 'RETAINED':
      return `Retained in ${from}`
    case 'COMPLETED':
      return `${from} · Removed from roster`
    default:
      return `${from} · Removed from roster`
  }
}

function Point({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-navy-600" />
      <span>{children}</span>
    </li>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cx(
        'tnum rounded-full px-3 py-1.5 text-[11.5px] font-medium transition-colors duration-100',
        on ? 'bg-navy-900 text-white' : 'bg-wash text-muted hover:text-navy-900',
      )}
    >
      {children}
    </button>
  )
}

function Count({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-[14px] bg-wash px-3.5 py-3">
      <div className="tnum font-display text-[22px] leading-none font-semibold text-navy-900">{n}</div>
      <div className="mt-1.5 text-[11px] leading-snug text-muted">{label}</div>
    </div>
  )
}
