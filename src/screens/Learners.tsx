import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUp,
  ChartLineUp,
  FolderOpen,
  MagnifyingGlass,
  Printer,
  Rows,
  Ruler,
  SquaresFour,
  UserPlus,
  UsersThree,
  X,
} from '@phosphor-icons/react'
import {
  Bar,
  BarChart,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { BandChip, Button, Empty, PILL, PILL_OFF, PILL_ON, cx } from '@/components/ui'
import { Modal, Popover, PopoverContent, PopoverTrigger, Select } from '@/components/primitives'
import { EnrolLearnerDialog } from '@/components/EnrolLearnerDialog'
import { ImportLearnersDialog } from '@/components/ImportLearnersDialog'
import { LearnerRecordDialog } from '@/components/LearnerRecordDialog'
import { RecordPreview } from '@/components/RecordPrint'
import { NAVY, ROYAL, Y, useMeasurementRows } from '@/components/bento'
import { AXIS_TICK, ChartTip } from '@/components/charts'
import { isFlagged } from '../lib/filters'
import { TODAY, fullName, type Learner } from '../data/mock'
import { SERVER_BACKED, useRoster } from '../lib/records'
import { BAND_COLOR, ageInMonths, assess, bmi, formatAge } from '../lib/nutrition'
import { formatDate } from '../lib/dates'
import { endpoints, type ApiFormerLearner, type EnrolmentOutcome } from '../lib/api'
import { useQuery } from '../lib/query'
import { useClassNames } from '../lib/school-year'

/* Learners: a grid of learner cards, nine to a page.

   Chosen by the user on 2026-10-10 from drafts on the design canvas, after a
   reference shot of a "patients list": one bar of status tabs with counts
   (plus search, grade and Add learner), then three-by-three cards, then page
   numbers. Nine per page because the user asked for it - the grid is the
   expensive part to draw, so only one page of it is ever on screen, even
   with "All" selected.

   Each card: initials, name, sex and age; status, BMI and last measured;
   and three small actions - measure, invite the parent (learners who need
   follow-up only), open the record. The chart button opens a quick look -
   BMI-for-age across weigh-ins, height and weight, and where the follow-up
   stands - and that card turns navy while it is open. Selecting the card
   anywhere else opens the full record, as the table rows did.

   The search, grade and status live in the URL (?q, ?grade, ?status), so the
   view survives a reload and the header search and dashboard links can open
   it already filtered. ?learner=<id> opens that learner's record.

   GRID OR TABLE (2026-10-13, the user's request). The same learners, the same
   filters and the same pages, drawn either as the cards above or as a
   standard table: one row per learner, sortable by its column headings,
   fifteen rows to a page. The choice is remembered on this computer.

   FORMER LEARNERS (2026-10-17, the user's choice over a screen of its own).
   The last tab lists everyone who has left the roster - completed Grade 6,
   transferred out, dropped - with the class and year they were last in and
   how it ended (?status=former). Their records are kept; selecting one opens
   the printable record, which is the reason to look one up. */

type View = 'grid' | 'table'
const PAGE_SIZE: Record<View, number> = { grid: 9, table: 15 }
const VIEW_KEY = 'chas.learners.view'

function savedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'grid'
  } catch {
    return 'grid'
  }
}

type StatusFilter =
  | 'all'
  | 'follow-up'
  | 'normal'
  | 'not-measured'
  | 'Severely Wasted'
  | 'Wasted'
  | 'Overweight'
  | 'Obese'
  | 'Severely Stunted'
  | 'Stunted'

/* Every value the URL may carry. The tab bar shows the first four; a single
   band (?status=Wasted) still filters, and shows as a tab of its own. */
const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'follow-up', label: 'Needs follow-up' },
  { value: 'not-measured', label: 'Not measured' },
  { value: 'normal', label: 'Normal' },
  { value: 'Severely Wasted', label: 'Severely wasted' },
  { value: 'Wasted', label: 'Wasted' },
  { value: 'Overweight', label: 'Overweight' },
  { value: 'Obese', label: 'Obese' },
  { value: 'Severely Stunted', label: 'Severely stunted' },
  { value: 'Stunted', label: 'Stunted' },
]

const needsFollowUp = (l: Learner) => Boolean(l.measuredOn && isFlagged(l))

function matchesStatus(l: Learner, status: StatusFilter): boolean {
  if (status === 'all') return true
  if (status === 'follow-up') return needsFollowUp(l)
  if (status === 'normal') return Boolean(l.measuredOn && !isFlagged(l))
  if (status === 'not-measured') return !l.measuredOn
  return l.bmiBand === status || l.hfaBand === status
}

/** The bands to show for a learner: the ones off normal, else Normal. */
function bandsOf(l: Learner): string[] {
  if (!l.measuredOn) return []
  const off = [l.bmiBand, l.hfaBand].filter((b): b is NonNullable<typeof b> => Boolean(b && b !== 'Normal'))
  return off.length ? off : ['Normal']
}

const bmiOf = (l: Learner) => (l.heightCm && l.weightKg ? bmi(l.weightKg, l.heightCm) : null)
const signed = (z: number) => `${z > 0 ? '+' : z < 0 ? '−' : ''}${Math.abs(z).toFixed(1)}`

/* Where a flagged learner's follow-up stands, as the card's bottom line says it. */
const FOLLOW: Record<Learner['slip'], { label: string; color: string }> = {
  'not-printed': { label: 'Not invited', color: '#a95f0f' },
  printed: { label: 'Invited', color: 'var(--color-navy-700)' },
  attended: { label: 'Attended', color: 'var(--color-gold-700)' },
}

/* --- Table sorting ----------------------------------------------------------- */

type SortKey = 'name' | 'grade' | 'age' | 'bmi' | 'status' | 'measured'

/* Worst first when sorted by status; not measured goes last. */
const STATUS_RANK = ['Severely Wasted', 'Severely Stunted', 'Wasted', 'Stunted', 'Obese', 'Overweight', 'Normal']
const statusRank = (l: Learner) => {
  const b = bandsOf(l)
  return b.length ? Math.min(...b.map((x) => STATUS_RANK.indexOf(x))) : STATUS_RANK.length
}

const SORTS: Record<SortKey, (a: Learner, b: Learner) => number> = {
  name: () => 0,
  grade: (a, b) => a.gradeLevel - b.gradeLevel || a.section.localeCompare(b.section),
  /* Youngest first: a later birthdate is a lower age. */
  age: (a, b) => b.birthDate.localeCompare(a.birthDate),
  bmi: (a, b) => (bmiOf(a) ?? -1) - (bmiOf(b) ?? -1),
  status: (a, b) => statusRank(a) - statusRank(b),
  measured: (a, b) => (a.measuredOn ?? '').localeCompare(b.measuredOn ?? ''),
}

/* Learners with nothing to sort on go last whichever way the column runs. */
const MISSING: Partial<Record<SortKey, (l: Learner) => boolean>> = {
  bmi: (l) => bmiOf(l) === null,
  status: (l) => !l.measuredOn,
  measured: (l) => !l.measuredOn,
}

export default function Learners() {
  const [params, setParams] = useSearchParams()
  const { learners } = useRoster()
  const goTo = useNavigate()

  const q = params.get('q') ?? ''
  const grade = params.get('grade') ?? 'all'
  const status = (STATUS_OPTIONS.some((s) => s.value === params.get('status')) ? params.get('status') : 'all') as StatusFilter
  const showFormer = SERVER_BACKED && params.get('status') === 'former'
  const formerQuery = useQuery(SERVER_BACKED ? 'learners:former' : null, () => endpoints.formerLearners())
  const former = formerQuery.data?.learners ?? []
  /* The former learner whose record preview is open. */
  const [printing, setPrinting] = useState<string | null>(null)

  function setParam(key: 'q' | 'grade' | 'status', value: string | null) {
    const next = new URLSearchParams(params)
    if (value && value !== 'all') next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  /* The search box is typed into freely and written to the URL a moment
     later, so the grid does not re-filter on every letter. */
  const [search, setSearch] = useState(q)
  useEffect(() => setSearch(q), [q])
  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== q) setParam('q', search.trim() || null)
    }, 200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const [page, setPage] = useState(1)
  const [view, setViewState] = useState<View>(savedView)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 })
  function setView(v: View) {
    setViewState(v)
    setPage(1)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* A blocked store only means the choice is not remembered. */
    }
  }
  const [selected, setSelected] = useState<string | null>(null)
  /* The card whose quick look is open. */
  const [peek, setPeek] = useState<string | null>(null)
  const [enrolling, setEnrolling] = useState(false)
  /* The Add learner window switched to importing a spreadsheet. */
  const [importing, setImporting] = useState(false)

  /* ?learner=<id> opens the record; consumed once. */
  useEffect(() => {
    const want = params.get('learner')
    if (!want) return
    setSelected(want)
    const next = new URLSearchParams(params)
    next.delete('learner')
    setParams(next, { replace: true })
  }, [params, setParams])

  /* Every class the school has, empty ones included, so a class just added
     in School settings can be picked before anyone is enrolled in it. */
  const grades = useClassNames(learners)

  /* Grade and search applied, status not: the tab counts are counted here,
     so each tab says how many it would show. */
  const base = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return learners.filter((l) => {
      if (grade !== 'all' && l.section !== grade) return false
      return !needle || fullName(l).toLowerCase().includes(needle) || l.lrn.includes(needle)
    })
  }, [learners, q, grade])

  const rows = useMemo(() => {
    const byName = (a: Learner, b: Learner) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)
    const list = base.filter((l) => matchesStatus(l, status))
    /* The grid is always alphabetical by surname, the order of a class
       register; the table sorts by whichever heading was chosen, with the
       name breaking ties. */
    if (view === 'grid') return list.sort(byName)
    const cmp = SORTS[sort.key]
    const missing = MISSING[sort.key]
    return list.sort((a, b) => {
      const ma = missing?.(a) ?? false
      const mb = missing?.(b) ?? false
      if (ma !== mb) return ma ? 1 : -1
      return cmp(a, b) * sort.dir || byName(a, b)
    })
  }, [base, status, view, sort])

  const formerRows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return former.filter((f) => {
      if (grade !== 'all' && f.section !== grade) return false
      return !needle || formerName(f).toLowerCase().includes(needle) || f.lrn.includes(needle)
    })
  }, [former, q, grade])

  const tabs = useMemo(() => {
    const main = STATUS_OPTIONS.slice(0, 4)
    const extra = STATUS_OPTIONS.find((s) => s.value === status && !main.includes(s))
    return [...main, ...(extra ? [extra] : [])].map((s) => ({
      ...s,
      n: base.filter((l) => matchesStatus(l, s.value)).length,
    }))
  }, [base, status])

  useEffect(() => setPage(1), [q, grade, status, sort, showFormer])
  const size = showFormer ? PAGE_SIZE.table : PAGE_SIZE[view]
  const listed = showFormer ? formerRows.length : rows.length
  const pageCount = Math.max(1, Math.ceil(listed / size))
  const safePage = Math.min(page, pageCount)
  const pageRows = rows.slice((safePage - 1) * size, safePage * size)
  const formerPage = formerRows.slice((safePage - 1) * size, safePage * size)
  useEffect(() => setPeek(null), [safePage, q, grade, status])

  const current = learners.find((l) => l.id === selected) ?? null
  /* The learner the dialog is drawing lags `current` by one close, so the
     dialog can animate out before its contents unmount. */
  const lastShown = useRef<Learner | null>(null)
  if (current) lastShown.current = current
  const shown = current ?? lastShown.current

  const narrowed = q !== '' || grade !== 'all' || status !== 'all'

  function clearFilters() {
    const next = new URLSearchParams(params)
    next.delete('q')
    next.delete('grade')
    next.delete('status')
    setParams(next, { replace: true })
    setSearch('')
  }

  const measure = (id: string) => goTo(`/weigh-in?learner=${encodeURIComponent(id)}`)
  const invite = (id: string) => goTo(`/slips?learner=${encodeURIComponent(id)}`)

  return (
    <div className="h-full overflow-auto px-6 pt-1 pb-6">
      {/* --- One bar: status tabs, then search, grade and Add learner ------ */}
      <div className="panel flex flex-wrap items-center justify-between gap-2 rounded-[16px] py-2 pr-2 pl-2.5">
        <div role="tablist" aria-label="Status" className="flex flex-wrap gap-1">
          {tabs.map((t) => {
            const on = !showFormer && status === t.value
            return (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setParam('status', t.value)}
                className={cx(PILL, 'h-[34px] px-4 text-[12.5px]', on ? PILL_ON : PILL_OFF)}
              >
                {t.label}
                <span className="tnum opacity-70">{t.n}</span>
              </button>
            )
          })}
          {SERVER_BACKED && (
            <button
              type="button"
              role="tab"
              aria-selected={showFormer}
              onClick={() => setParam('status', 'former')}
              className={cx(PILL, 'h-[34px] px-4 text-[12.5px]', showFormer ? PILL_ON : PILL_OFF)}
            >
              Former learners
              <span className="tnum opacity-70">{former.length}</span>
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="relative block w-[240px]">
            <MagnifyingGlass size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-placeholder" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or LRN"
              aria-label="Search by name or LRN"
              className="h-9 w-full rounded-[10px] bg-wash pr-8 pl-9 text-[12.5px] text-ink placeholder:text-placeholder focus:bg-white focus:shadow-[inset_0_0_0_1px_var(--color-navy-600),0_0_0_3px_rgba(43,82,196,0.14)] focus:outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute top-1/2 right-2 grid size-5 -translate-y-1/2 place-items-center rounded-full text-placeholder hover:bg-navy-50 hover:text-navy-900"
              >
                <X size={11} weight="bold" />
              </button>
            )}
          </label>

          <Select
            label="Grade"
            value={grade}
            onValueChange={(v) => setParam('grade', v)}
            options={[{ value: 'all', label: 'All grades' }, ...grades.map((g) => ({ value: g.name, label: g.name }))]}
          />

          {/* Grid or table. Former learners are always a table. */}
          <div role="radiogroup" hidden={showFormer} aria-label="View" className="flex gap-0.5 rounded-full bg-wash p-[3px]">
            {(
              [
                ['grid', 'Grid', SquaresFour],
                ['table', 'Table', Rows],
              ] as const
            ).map(([key, label, Icon]) => {
              const on = view === key
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={`${label} view`}
                  title={`${label} view`}
                  onClick={() => setView(key)}
                  className={cx(
                    'grid size-[30px] place-items-center rounded-full transition-colors duration-100',
                    on ? 'bg-navy-800 text-white' : 'text-muted hover:text-navy-900',
                  )}
                >
                  <Icon size={15} weight={on ? 'fill' : 'bold'} />
                </button>
              )
            })}
          </div>

          {SERVER_BACKED && (
            <button
              type="button"
              onClick={() => setEnrolling(true)}
              className="flex h-9 items-center gap-2 rounded-[10px] px-4 text-[12.5px] font-semibold text-[#071539] transition-[filter] duration-100 hover:brightness-95 active:translate-y-px"
              style={{ background: Y }}
            >
              <UserPlus size={15} weight="bold" />
              Add learner
            </button>
          )}
        </div>
      </div>

      {/* --- Cards, nine to a page ------------------------------------------ */}
      {showFormer ? (
        formerRows.length === 0 ? (
          <div className="panel mt-3 pt-6 pb-10">
            <Empty
              icon={<UsersThree size={32} />}
              title={formerQuery.loading ? 'Loading…' : q || grade !== 'all' ? 'No learners match' : 'No former learners'}
              body={
                formerQuery.error
                  ? 'Unable to load the list.'
                  : 'Learners who complete the last grade or leave the school are listed here.'
              }
            />
          </div>
        ) : (
          <>
            <FormerTable rows={formerPage} onOpen={setPrinting} />
            <Pager
              first={(safePage - 1) * size + 1}
              last={Math.min(safePage * size, formerRows.length)}
              total={formerRows.length}
              page={safePage}
              pageCount={pageCount}
              setPage={setPage}
            />
          </>
        )
      ) : rows.length === 0 ? (
        <div className="panel mt-3 pt-6 pb-10">
          <Empty
            icon={<UsersThree size={32} />}
            title={narrowed ? 'No learners match' : 'No learners registered'}
            body={narrowed ? 'Try another search or filter.' : 'Add a learner to begin.'}
          />
          <div className="mt-3 flex justify-center">
            {narrowed ? (
              <Button onClick={clearFilters}>Clear filters</Button>
            ) : SERVER_BACKED ? (
              <Button onClick={() => setEnrolling(true)} icon={<UserPlus size={14} weight="bold" />}>
                Add learner
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          {view === 'grid' ? (
            <div className="mt-3 grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
              {pageRows.map((l) => (
                <LearnerCard
                  key={l.id}
                  l={l}
                  peeking={peek === l.id}
                  onPeek={(open) => setPeek(open ? l.id : null)}
                  onOpen={() => setSelected(l.id)}
                  onMeasure={() => measure(l.id)}
                  onInvite={() => invite(l.id)}
                />
              ))}
            </div>
          ) : (
            <LearnerTable
              rows={pageRows}
              sort={sort}
              onSort={(key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }))}
              onOpen={(id) => setSelected(id)}
              onMeasure={measure}
              onInvite={invite}
            />
          )}

          {/* --- Page numbers ---------------------------------------------- */}
          <Pager
            first={(safePage - 1) * size + 1}
            last={Math.min(safePage * size, rows.length)}
            total={rows.length}
            page={safePage}
            pageCount={pageCount}
            setPage={setPage}
          />
        </>
      )}

      <Modal
        open={!!current}
        onOpenChange={(o) => {
          if (!o) setSelected(null)
        }}
      >
        {shown && (
          <LearnerRecordDialog
            learner={shown}
            onWeighIn={(id) => measure(id)}
            onSlips={(id) => invite(id)}
            onSaved={() => undefined}
          />
        )}
      </Modal>

      <Modal open={printing !== null} onOpenChange={(o) => !o && setPrinting(null)}>
        {printing && <RecordPreview learnerId={printing} onClose={() => setPrinting(null)} />}
      </Modal>

      <Modal
        open={enrolling}
        onOpenChange={(o) => {
          setEnrolling(o)
          if (!o) setImporting(false)
        }}
      >
        {enrolling && importing && (
          <ImportLearnersDialog
            section={grade === 'all' ? '' : grade}
            onDone={() => {
              setEnrolling(false)
              setImporting(false)
            }}
          />
        )}
        {enrolling && !importing && (
          <EnrolLearnerDialog
            section={grade === 'all' ? '' : grade}
            onImport={() => setImporting(true)}
            onDone={() => setEnrolling(false)}
            onView={(id) => {
              setEnrolling(false)
              setSelected(id)
            }}
            onAssess={(id) => {
              setEnrolling(false)
              goTo(`/weigh-in?learner=${id}`)
            }}
          />
        )}
      </Modal>
    </div>
  )
}

/* --- One learner ------------------------------------------------------------ */

function LearnerCard({
  l,
  peeking,
  onPeek,
  onOpen,
  onMeasure,
  onInvite,
}: {
  l: Learner
  peeking: boolean
  onPeek: (open: boolean) => void
  onOpen: () => void
  onMeasure: () => void
  onInvite: () => void
}) {
  const bands = bandsOf(l)
  const b = bmiOf(l)
  const flagged = needsFollowUp(l)
  const statusColor = bands.length === 0 ? undefined : BAND_COLOR[bands[0] as keyof typeof BAND_COLOR]
  const follow = flagged ? FOLLOW[l.slip] : null
  const initials = `${l.firstName[0] ?? ''}${l.lastName[0] ?? ''}`.toUpperCase()

  /* The card opens the record; its buttons do their own thing and must not
     also open it. */
  const own = (fn: () => void) => (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    fn()
  }

  return (
    <article
      onClick={onOpen}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) onOpen()
      }}
      tabIndex={0}
      data-learner={l.id}
      aria-label={`Open the record of ${fullName(l)}`}
      className={cx(
        'focus-ring flex cursor-pointer flex-col gap-2.5 rounded-[18px] px-4 py-3.5 transition-[box-shadow,transform] duration-150 focus-visible:outline-none',
        peeking
          ? 'bg-navy-900 text-white shadow-[0_16px_30px_-16px_rgba(14,36,100,0.7)]'
          : 'bg-white text-navy-900 shadow-[var(--shadow-rest)] hover:-translate-y-px hover:shadow-[var(--shadow-raised)]',
      )}
    >
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-navy-50 text-[12px] font-bold text-navy-700">
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-bold">
            {l.lastName}, {l.firstName}
          </div>
          <div className={cx('text-[11.5px]', peeking ? 'text-white/70' : 'text-muted')}>
            {l.sex === 'M' ? 'Male' : 'Female'} · {formatAge(ageInMonths(l.birthDate, TODAY))} · {l.section}
          </div>
        </div>
        <Popover open={peeking} onOpenChange={onPeek}>
          <PopoverTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              aria-label={`Quick look: ${fullName(l)}`}
              title="Quick look"
              className={cx(
                'grid size-8 shrink-0 place-items-center rounded-[10px] transition-colors duration-100',
                peeking ? 'bg-white/14 text-white' : 'bg-wash text-navy-700 hover:bg-navy-50',
              )}
            >
              <ChartLineUp size={15} weight="bold" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="max-h-none w-[600px] max-w-[calc(100vw-24px)] rounded-[20px] p-3.5"
            onClick={(e) => e.stopPropagation()}
          >
            <QuickLook l={l} onOpen={onOpen} onMeasure={onMeasure} onInvite={onInvite} />
          </PopoverContent>
        </Popover>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11.5px]">
        <dt className={peeking ? 'text-white/70' : 'text-muted'}>Status</dt>
        <dd
          className="truncate text-right font-bold"
          style={{ color: peeking ? '#ffd9c2' : (statusColor ?? 'var(--color-placeholder)') }}
        >
          {bands.length ? bands.join(' · ') : 'Not measured'}
        </dd>
        <dt className={peeking ? 'text-white/70' : 'text-muted'}>BMI</dt>
        <dd className="tnum text-right font-semibold">
          {b === null ? '–' : `${b.toFixed(1)}${l.bmiZ === null ? '' : ` · z ${signed(l.bmiZ)}`}`}
        </dd>
        <dt className={peeking ? 'text-white/70' : 'text-muted'}>Last measured</dt>
        <dd className="text-right font-semibold">{l.measuredOn ? formatDate(l.measuredOn) : '–'}</dd>
      </dl>

      <div className="flex items-center gap-1.5">
        <IconAction label={l.measuredOn ? 'Measure again' : 'Measure'} onClick={own(onMeasure)} primary peeking={peeking}>
          <Ruler size={14} weight="bold" />
        </IconAction>
        <IconAction
          label={flagged ? 'Invite parent' : 'Invite parent (for learners who need follow-up)'}
          onClick={own(onInvite)}
          disabled={!flagged}
          peeking={peeking}
        >
          <Printer size={14} weight="bold" />
        </IconAction>
        <IconAction label="Open record" onClick={own(onOpen)} peeking={peeking}>
          <FolderOpen size={14} weight="bold" />
        </IconAction>
        <span className="flex-1" />
        {follow && (
          <span className="text-[11px] font-semibold" style={{ color: peeking ? Y : follow.color }}>
            {follow.label}
          </span>
        )}
      </div>
    </article>
  )
}

/* --- The table view -------------------------------------------------------------
   One row per learner. The headings with a caret sort; selecting a heading
   again reverses it. The row opens the record, and its three buttons do what
   the card's do. */

const COLUMNS: { label: string; sort?: SortKey; className?: string }[] = [
  { label: 'Learner', sort: 'name', className: 'pl-4' },
  { label: 'Grade', sort: 'grade' },
  { label: 'Sex' },
  { label: 'Age', sort: 'age' },
  { label: 'Height', className: 'text-right' },
  { label: 'Weight', className: 'text-right' },
  { label: 'BMI', sort: 'bmi', className: 'text-right' },
  { label: 'Status', sort: 'status' },
  { label: 'Last measured', sort: 'measured' },
  { label: 'Follow-up' },
  { label: '', className: 'pr-4' },
]

function LearnerTable({
  rows,
  sort,
  onSort,
  onOpen,
  onMeasure,
  onInvite,
}: {
  rows: Learner[]
  sort: { key: SortKey; dir: 1 | -1 }
  onSort: (key: SortKey) => void
  onOpen: (id: string) => void
  onMeasure: (id: string) => void
  onInvite: (id: string) => void
}) {
  const own = (fn: () => void) => (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    fn()
  }
  return (
    <div className="panel mt-3 overflow-x-auto rounded-[18px] p-0">
      <table className="w-full min-w-[940px] border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-line-soft">
            {COLUMNS.map((c) => {
              const active = c.sort && sort.key === c.sort
              return (
                <th
                  key={c.label || 'actions'}
                  scope="col"
                  aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
                  className={cx(
                    'px-2 py-3 text-left text-[10.5px] font-semibold tracking-[0.05em] whitespace-nowrap text-placeholder uppercase',
                    c.className,
                  )}
                >
                  {c.sort ? (
                    <button
                      type="button"
                      onClick={() => onSort(c.sort!)}
                      className={cx(
                        'inline-flex items-center gap-1 uppercase transition-colors duration-100 hover:text-navy-900',
                        active && 'text-navy-900',
                      )}
                    >
                      {c.label}
                      {active ? (
                        sort.dir === 1 ? <CaretUp size={10} weight="bold" /> : <CaretDown size={10} weight="bold" />
                      ) : (
                        <CaretDown size={10} weight="bold" className="opacity-30" />
                      )}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody className="tnum">
          {rows.map((l) => {
            const bands = bandsOf(l)
            const b = bmiOf(l)
            const flagged = needsFollowUp(l)
            const follow = flagged ? FOLLOW[l.slip] : null
            return (
              <tr
                key={l.id}
                onClick={() => onOpen(l.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(l.id)
                }}
                tabIndex={0}
                aria-label={`Open the record of ${fullName(l)}`}
                className="focus-ring cursor-pointer border-b border-line-soft transition-colors duration-100 last:border-b-0 hover:bg-wash focus-visible:outline-none"
              >
                <td className="py-2 pr-2 pl-4">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-navy-50 text-[10.5px] font-bold text-navy-700">
                      {`${l.firstName[0] ?? ''}${l.lastName[0] ?? ''}`.toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold whitespace-nowrap text-navy-900">
                        {l.lastName}, {l.firstName} {l.middleName ? `${l.middleName[0]}.` : ''}
                      </span>
                      <span className="block font-mono text-[10.5px] text-muted">{l.lrn}</span>
                    </span>
                  </span>
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-navy-900">{l.section}</td>
                <td className="px-2 py-2 text-muted">{l.sex}</td>
                <td className="px-2 py-2 whitespace-nowrap text-navy-900">{formatAge(ageInMonths(l.birthDate, TODAY))}</td>
                <td className="px-2 py-2 text-right whitespace-nowrap text-navy-900">{l.heightCm === null ? '–' : `${l.heightCm.toFixed(1)} cm`}</td>
                <td className="px-2 py-2 text-right whitespace-nowrap text-navy-900">{l.weightKg === null ? '–' : `${l.weightKg.toFixed(1)} kg`}</td>
                <td className="px-2 py-2 text-right font-semibold whitespace-nowrap text-navy-900">{b === null ? '–' : b.toFixed(1)}</td>
                <td className="px-2 py-2">
                  {bands.length ? (
                    <span className="flex flex-wrap gap-1">
                      {bands.map((x) => (
                        <BandChip key={x} band={x} dense />
                      ))}
                    </span>
                  ) : (
                    <BandChip band={null} dense />
                  )}
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-navy-900">{l.measuredOn ? formatDate(l.measuredOn) : '–'}</td>
                <td className="px-2 py-2 whitespace-nowrap">
                  {follow ? (
                    <span className="text-[11.5px] font-semibold" style={{ color: follow.color }}>
                      {follow.label}
                    </span>
                  ) : (
                    <span className="text-placeholder">–</span>
                  )}
                </td>
                <td className="py-2 pr-4 pl-2">
                  <span className="flex justify-end gap-1">
                    <IconAction label={l.measuredOn ? 'Measure again' : 'Measure'} onClick={own(() => onMeasure(l.id))} primary peeking={false}>
                      <Ruler size={14} weight="bold" />
                    </IconAction>
                    <IconAction
                      label={flagged ? 'Invite parent' : 'Invite parent (for learners who need follow-up)'}
                      onClick={own(() => onInvite(l.id))}
                      disabled={!flagged}
                      peeking={false}
                    >
                      <Printer size={14} weight="bold" />
                    </IconAction>
                    <IconAction label="Open record" onClick={own(() => onOpen(l.id))} peeking={false}>
                      <FolderOpen size={14} weight="bold" />
                    </IconAction>
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function IconAction({
  label,
  onClick,
  children,
  primary,
  disabled,
  peeking,
}: {
  label: string
  onClick: (e: { stopPropagation: () => void }) => void
  children: ReactNode
  primary?: boolean
  disabled?: boolean
  peeking: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cx(
        'grid size-[30px] place-items-center rounded-[9px] transition-colors duration-100',
        'disabled:cursor-not-allowed disabled:opacity-35',
        primary
          ? peeking
            ? 'bg-white text-navy-900'
            : 'bg-navy-900 text-white hover:bg-navy-800'
          : peeking
            ? 'bg-white/14 text-white hover:bg-white/22'
            : 'bg-wash text-navy-700 enabled:hover:bg-navy-50',
      )}
    >
      {children}
    </button>
  )
}

/* --- Quick look ---------------------------------------------------------------
   The learner at a glance without opening the record: BMI-for-age at every
   weigh-in (the normal range shaded, the wasted line dashed), height and
   weight per weigh-in, and where the follow-up stands with the next step. */

function QuickLook({
  l,
  onOpen,
  onMeasure,
  onInvite,
}: {
  l: Learner
  onOpen: () => void
  onMeasure: () => void
  onInvite: () => void
}) {
  const all = useMeasurementRows(useMemo(() => [l], [l]))
  const series = useMemo(() => {
    const own = all.filter((r) => r.learnerId === l.id)
    /* The local build keeps only this year's measurement; the one before it
       rides along as `previous`. */
    if (own.length <= 1 && l.previous) {
      own.unshift({ learnerId: l.id, ...l.previous })
    }
    return own
      .sort((a, b) => a.measuredOn.localeCompare(b.measuredOn))
      .map((r) => {
        const a = assess(r.weightKg, r.heightCm, l.birthDate, r.measuredOn, l.sex)
        const d = new Date(`${r.measuredOn}T00:00`)
        return {
          label: `${d.toLocaleDateString('en-US', { month: 'short' })} '${r.measuredOn.slice(2, 4)}`,
          date: formatDate(r.measuredOn),
          z: a.bmiZ === null ? null : Math.round(a.bmiZ * 10) / 10,
          band: a.bmiBand,
          height: r.heightCm,
          weight: r.weightKg,
        }
      })
  }, [all, l])

  const last = series[series.length - 1]
  const zs = series.map((s) => s.z).filter((z): z is number => z !== null)
  const lo = Math.floor(Math.min(-3, ...zs) - 0.5)
  const hi = Math.ceil(Math.max(2, ...zs) + 0.5)
  const flagged = needsFollowUp(l)
  /* In a sentence: "Severely stunted and wasted." */
  const bands = bandsOf(l).map((b, i) => (i === 0 ? b.charAt(0) + b.slice(1).toLowerCase() : b.toLowerCase()))

  let followText: string
  let action: { label: string; run: () => void }
  if (!l.measuredOn) {
    followText = 'Not measured this school year.'
    action = { label: 'Measure', run: onMeasure }
  } else if (!flagged) {
    followText = 'Normal on both indices. No follow-up needed.'
    action = { label: 'Open record', run: onOpen }
  } else if (l.slip === 'not-printed') {
    followText = `${bands.join(' and ')}. Invitation slip not printed.`
    action = { label: 'Invite parent', run: onInvite }
  } else if (l.slip === 'printed') {
    followText = `${bands.join(' and ')}. Parent invited${l.slipMeeting ? ` to the meeting on ${formatDate(l.slipMeeting.date)}` : ''}.`
    action = { label: 'Open record', run: onOpen }
  } else {
    followText = `${bands.join(' and ')}. Parent attended${l.attendedAt ? ` on ${formatDate(l.attendedAt)}` : ''}.`
    action = { label: 'Open record', run: onOpen }
  }

  return (
    <div>
      <div className="mb-2.5 flex items-baseline justify-between gap-3 px-1">
        <span className="truncate text-[13px] font-bold text-navy-900">
          {l.lastName}, {l.firstName}
        </span>
        <span className="text-[11px] text-muted">
          {series.length === 0 ? 'No measurements recorded' : `${series.length} weigh-in${series.length === 1 ? '' : 's'}`}
        </span>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-2.5">
        <div className="rounded-[14px] p-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
          <div className="text-[12px] font-semibold text-navy-900">BMI-for-age</div>
          <div
            className="tnum text-[11px] font-semibold"
            style={{ color: last?.band ? BAND_COLOR[last.band] : 'var(--color-muted)' }}
          >
            {last?.z != null ? `z ${signed(last.z)} · ${last.band}` : '–'}
          </div>
          <div className="mt-1.5 h-[96px]">
            {series.length > 0 && (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 6, right: 8, bottom: 0, left: 8 }}>
                  <ReferenceArea y1={-2} y2={1} fill="var(--color-n)" fillOpacity={0.08} />
                  <ReferenceLine y={-2} stroke="var(--color-w)" strokeDasharray="3 3" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ ...AXIS_TICK, fontSize: 9 }} interval="preserveStartEnd" />
                  <YAxis hide domain={[lo, hi]} />
                  <Tooltip
                    cursor={{ stroke: ROYAL, strokeOpacity: 0.25 }}
                    content={({ active, payload }) => {
                      const p = active && payload?.[0] ? (payload[0].payload as (typeof series)[number]) : null
                      return p ? <ChartTip title={p.z === null ? '–' : `z ${signed(p.z)}`}>{p.date}</ChartTip> : null
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="z"
                    stroke={ROYAL}
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: '#fff', stroke: ROYAL, strokeWidth: 2 }}
                    activeDot={{ r: 4.5, fill: ROYAL, stroke: '#fff', strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-[14px] p-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
          <div className="text-[12px] font-semibold text-navy-900">Height and weight</div>
          <div className="tnum text-[11px] text-muted">
            {last ? `${last.height.toFixed(1)} cm · ${last.weight.toFixed(1)} kg` : '–'}
          </div>
          <div className="mt-1.5 h-[96px]">
            {series.length > 0 && (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series} margin={{ top: 6, right: 4, bottom: 0, left: 4 }} barGap={3}>
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ ...AXIS_TICK, fontSize: 9 }} />
                  <YAxis yAxisId="h" hide domain={['dataMin - 12', 'dataMax + 2']} />
                  <YAxis yAxisId="w" hide domain={['dataMin - 5', 'dataMax + 1']} />
                  <Tooltip
                    cursor={{ fill: 'var(--color-wash)', radius: 6 }}
                    content={({ active, payload }) => {
                      const p = active && payload?.[0] ? (payload[0].payload as (typeof series)[number]) : null
                      return p ? (
                        <ChartTip title={p.date}>
                          <div>Height {p.height.toFixed(1)} cm</div>
                          <div>Weight {p.weight.toFixed(1)} kg</div>
                        </ChartTip>
                      ) : null
                    }}
                  />
                  <Bar yAxisId="h" dataKey="height" fill={ROYAL} radius={[5, 5, 5, 5]} maxBarSize={16} />
                  <Bar yAxisId="w" dataKey="weight" fill="var(--color-n)" radius={[5, 5, 5, 5]} maxBarSize={16} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 rounded-[14px] p-3 text-white" style={{ background: NAVY }}>
          <div className="text-[12px] font-bold">Follow-up</div>
          <p className="text-[11px] leading-snug text-white/80">{followText}</p>
          <button
            type="button"
            onClick={action.run}
            className="mt-auto h-8 rounded-[10px] text-[12px] font-bold text-[#071539] transition-[filter] duration-100 hover:brightness-95"
            style={{ background: Y }}
          >
            {action.label}
          </button>
        </div>
      </div>
    </div>
  )
}

/* --- Former learners ----------------------------------------------------------
   Read-only: they are not on the roster, so there is nothing to measure or
   invite. The row and its one button open the printable record. */

const OUTCOME_LABEL: Record<EnrolmentOutcome, string> = {
  PROMOTED: 'Promoted',
  RETAINED: 'Retained',
  COMPLETED: 'Completed',
  TRANSFERRED_OUT: 'Transferred out',
  DROPPED: 'Dropped',
}

const formerName = (f: ApiFormerLearner) =>
  `${f.lastName}, ${f.firstName}${f.middleName ? ` ${f.middleName.charAt(0)}.` : ''}`

function leftAs(f: ApiFormerLearner): string {
  if (f.outcome) return f.outcome === 'COMPLETED' ? `Completed ${f.gradeName}` : OUTCOME_LABEL[f.outcome]
  if (f.status === 'TRANSFERRED_OUT') return 'Transferred out'
  if (f.status === 'DROPPED') return 'Dropped'
  return 'Removed from the roster'
}

function FormerTable({ rows, onOpen }: { rows: ApiFormerLearner[]; onOpen: (id: string) => void }) {
  const head = 'px-2 py-3 text-left text-[10.5px] font-semibold tracking-[0.05em] whitespace-nowrap text-placeholder uppercase'
  return (
    <div className="panel mt-3 overflow-x-auto rounded-[18px] p-0">
      <table className="w-full min-w-[760px] border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-line-soft">
            <th scope="col" className={cx(head, 'pl-4')}>
              Learner
            </th>
            <th scope="col" className={head}>
              Sex
            </th>
            <th scope="col" className={head}>
              Last class
            </th>
            <th scope="col" className={head}>
              School year
            </th>
            <th scope="col" className={head}>
              Left as
            </th>
            <th scope="col" className={cx(head, 'pr-4')}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="tnum">
          {rows.map((f) => (
            <tr
              key={f.id}
              onClick={() => onOpen(f.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(f.id)
              }}
              tabIndex={0}
              aria-label={`Print the record of ${formerName(f)}`}
              className="focus-ring cursor-pointer border-b border-line-soft transition-colors duration-100 last:border-b-0 hover:bg-wash focus-visible:outline-none"
            >
              <td className="py-2 pr-2 pl-4">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-navy-50 text-[10.5px] font-bold text-navy-700">
                    {`${f.firstName[0] ?? ''}${f.lastName[0] ?? ''}`.toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold whitespace-nowrap text-navy-900">
                      {f.lastName}, {f.firstName} {f.middleName ? `${f.middleName[0]}.` : ''}
                    </span>
                    <span className="block font-mono text-[10.5px] text-muted">{f.lrn}</span>
                  </span>
                </span>
              </td>
              <td className="px-2 py-2 text-muted">{f.sex}</td>
              <td className="px-2 py-2 whitespace-nowrap text-navy-900">{f.section}</td>
              <td className="px-2 py-2 whitespace-nowrap text-navy-900">{f.schoolYear ?? '–'}</td>
              <td className="px-2 py-2 font-semibold whitespace-nowrap text-navy-900">{leftAs(f)}</td>
              <td className="py-2 pr-4 pl-2">
                <span className="flex justify-end">
                  <Button
                    className="h-8 px-3 text-[12px]"
                    icon={<Printer size={13} weight="bold" />}
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpen(f.id)
                    }}
                  >
                    Print record
                  </Button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* --- Pages ------------------------------------------------------------------- */

function Pager({
  first,
  last,
  total,
  page,
  pageCount,
  setPage,
}: {
  first: number
  last: number
  total: number
  page: number
  pageCount: number
  setPage: (n: number) => void
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 px-1">
      <span className="tnum text-[12px] text-muted">
        {first}–{last} of {total} learners
      </span>
      <nav className="flex items-center gap-1.5" aria-label="Pages">
        <PageButton label="Previous page" disabled={page === 1} onClick={() => setPage(page - 1)}>
          <CaretLeft size={12} weight="bold" />
        </PageButton>
        {pagesAround(page, pageCount).map((n, i) =>
          n === null ? (
            <span key={`gap-${i}`} className="px-1 text-[11px] text-placeholder">
              …
            </span>
          ) : (
            <PageButton key={n} label={`Page ${n}`} active={n === page} onClick={() => setPage(n)}>
              {n}
            </PageButton>
          ),
        )}
        <PageButton label="Next page" disabled={page === pageCount} onClick={() => setPage(page + 1)}>
          <CaretRight size={12} weight="bold" />
        </PageButton>
      </nav>
    </div>
  )
}

function PageButton({
  children,
  label,
  active,
  disabled,
  onClick,
}: {
  children: ReactNode
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'tnum grid h-[30px] min-w-[30px] place-items-center rounded-[9px] px-1.5 text-[12px] font-semibold',
        'shadow-[0_1px_2px_rgba(14,36,100,0.06)] transition-colors duration-100',
        'disabled:cursor-not-allowed disabled:opacity-40',
        active ? 'bg-navy-900 text-white' : 'bg-white text-navy-900 enabled:hover:bg-navy-50',
      )}
    >
      {children}
    </button>
  )
}

/** `1 2 3 … 13`: the ends, the neighbours, and a gap for the rest. */
function pagesAround(current: number, count: number): (number | null)[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1)
  const out: (number | null)[] = [1]
  const from = Math.max(2, current - 1)
  const to = Math.min(count - 1, current + 1)
  if (from > 2) out.push(null)
  for (let n = from; n <= to; n++) out.push(n)
  if (to < count - 1) out.push(null)
  out.push(count)
  return out
}
