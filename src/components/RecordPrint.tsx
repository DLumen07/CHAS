import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { FilePdf, Printer, X } from '@phosphor-icons/react'
import { Button } from './ui'
import { ModalContent, ModalDescription, ModalTitle } from './primitives'
import { toast } from './toast'
import { LABELS } from './form'
import { endpoints, schoolLogoUrl, type ApiLearnerRecord, type EnrolmentOutcome } from '../lib/api'
import { growthRows } from '../lib/growth'
import {
  ageInMonths,
  classifyBmiForAge,
  classifyHeightForAge,
  formatAge,
  zHeightForAge,
} from '../lib/nutrition'
import { useSchool, type SchoolIdentity } from '../lib/school-year'
import { cached } from '../lib/query'
import { todayIso } from '../lib/dates'
import { canSavePdf, printPaper, savePdf } from '../lib/print'

/* One learner's record on paper: everything the school holds on them.

   WHAT IT IS FOR. When a learner completes Grade 6 the school files a copy
   or hands it over, and by then the learner is no longer on the roster. So
   this reads the record by id (GET /learners/:id answers for archived
   learners too) and needs nothing from the roster.

   WHAT IS ON IT. The particulars, the classes year by year, every weigh-in
   with both WHO indices, the immunization card, the health history and the
   invitation slips, then NOTHING FOLLOWS and two signature lines. No parent
   or guardian: the app stopped holding those on 2026-10-15.

   THE PAGES ARE LAID OUT HERE, AS FOR THE SF8. Every part is measured once
   off screen, `paginate` decides the pages, and the preview and the PDF draw
   those same pages. A table that runs over repeats its column headings, a
   section heading never ends a page, and every page carries the learner's
   name, LRN and "Page n of m" at the foot. Letter, portrait, half-inch
   margins: `@page record` in index.css. */

/** The printable area of a page in CSS pixels: letter less half-inch margins. */
const PAGE = { width: 7.5 * 96, height: 10 * 96 }
/** The whole sheet, for the preview. */
const SHEET = { width: 8.5 * 96, height: 11 * 96 }
const MARGIN = 0.5 * 96
/** Kept free at the foot of every page for the page line. */
const FOOT = 30
/** Slack for rounding between the measured and the printed layout. */
const SLACK = 6

const OUTCOME: Record<EnrolmentOutcome, string> = {
  PROMOTED: 'Promoted',
  RETAINED: 'Retained',
  COMPLETED: 'Completed',
  TRANSFERRED_OUT: 'Transferred out',
  DROPPED: 'Dropped',
}

const CARD: Record<'complete' | 'incomplete' | 'none', string> = {
  complete: 'Complete',
  incomplete: 'Incomplete',
  none: 'No card on file',
}

/* --- The content, as tables ---------------------------------------------- */

type TableId = 'classes' | 'measures' | 'doses' | 'conditions' | 'slips'

interface Table {
  id: TableId
  cols: { label: string; width: string; align?: 'right' | 'center' }[]
  rows: ReactNode[][]
}

/** One piece of a page, in reading order. */
type Unit =
  | { kind: 'head' }
  | { kind: 'section'; n: number; title: string }
  | { kind: 'row'; table: TableId; i: number }
  | { kind: 'empty'; text: string }
  | { kind: 'text'; label: string; text: string }
  | { kind: 'end' }
  | { kind: 'sign' }

interface Doc {
  record: ApiLearnerRecord
  school: SchoolIdentity
  printedOn: string
  tables: Record<TableId, Table>
  units: Unit[]
}

function mdy(iso: string | null | undefined): string {
  if (!iso) return ''
  const day = iso.length > 10 ? localDay(iso) : iso
  const [y, m, d] = day.split('-')
  return y && m && d ? `${m}/${d}/${y}` : iso
}

/** An instant as a date on this computer's calendar. */
function localDay(instant: string): string {
  const d = new Date(instant)
  if (Number.isNaN(d.getTime())) return instant.slice(0, 10)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function zText(z: number | null): string {
  if (z === null) return ''
  return z > 0 ? `+${z.toFixed(2)}` : z.toFixed(2)
}

export function fullName(r: Pick<ApiLearnerRecord, 'lastName' | 'firstName' | 'middleName' | 'nameExt'>): string {
  return [`${r.lastName.toUpperCase()},`, r.firstName, r.nameExt, r.middleName].filter(Boolean).join(' ')
}

/** Where the learner stands now, in one line. */
function standing(r: ApiLearnerRecord): string {
  const e = r.enrolments[0]
  if (!e) return r.archivedAt ? 'No longer enrolled' : 'Enrolled'
  const grade = e.gradeName === e.section ? e.gradeName : `${e.gradeName} – ${e.section}`
  if (e.outcome === 'COMPLETED') return `Completed ${e.gradeName}, S.Y. ${e.schoolYear}`
  if (e.outcome === 'TRANSFERRED_OUT' || e.outcome === 'DROPPED') {
    return `${OUTCOME[e.outcome]}, S.Y. ${e.schoolYear}`
  }
  if (r.archivedAt) return `No longer enrolled (last enrolled ${grade}, S.Y. ${e.schoolYear})`
  return `${LABELS.enrolment[e.status]}, ${grade}, S.Y. ${e.schoolYear}`
}

export function buildDoc(record: ApiLearnerRecord, school: SchoolIdentity): Doc {
  const r = record

  /* Weigh-ins and absences in one list, oldest first. */
  const measured = growthRows(r).map((g) => {
    const months = r.birthDate ? ageInMonths(r.birthDate, g.date) : null
    const hz = g.height && months !== null ? zHeightForAge(g.height, months, r.sex) : null
    return {
      date: g.date,
      cells: [
        mdy(g.date),
        months === null ? '' : formatAge(months),
        g.height !== null ? g.height.toFixed(1) : '',
        g.weight !== null ? g.weight.toFixed(1) : '',
        g.bmi !== null ? g.bmi.toFixed(1) : '',
        g.z === null ? 'Not assessed' : `${classifyBmiForAge(g.z)} (${zText(g.z)})`,
        hz === null ? 'Not assessed' : `${classifyHeightForAge(hz)} (${zText(hz)})`,
      ] as ReactNode[],
    }
  })
  const taken = new Set(measured.map((m) => m.date))
  const absent = r.absences
    .map((a) => a.measuredOn)
    .filter((d): d is string => Boolean(d) && !taken.has(d as string))
    .map((d) => ({
      date: d,
      cells: [mdy(d), '', '', '', '', 'Absent on the weigh-in date', ''] as ReactNode[],
    }))
  const measures = [...measured, ...absent].sort((a, b) => a.date.localeCompare(b.date))

  const tables: Record<TableId, Table> = {
    classes: {
      id: 'classes',
      cols: [
        { label: 'School year', width: '16%' },
        { label: 'Grade level', width: '20%' },
        { label: 'Section', width: '24%' },
        { label: 'Enrolment status', width: '20%' },
        { label: 'End of year', width: '20%' },
      ],
      /* Oldest first, the order a record is read in. */
      rows: [...r.enrolments].reverse().map((e) => [
        e.schoolYear,
        e.gradeName,
        e.section,
        LABELS.enrolment[e.status],
        e.outcome ? OUTCOME[e.outcome] : 'In progress',
      ]),
    },
    measures: {
      id: 'measures',
      cols: [
        { label: 'Date', width: '12%' },
        { label: 'Age', width: '9%' },
        { label: 'Height (cm)', width: '10%', align: 'right' },
        { label: 'Weight (kg)', width: '10%', align: 'right' },
        { label: 'BMI', width: '7%', align: 'right' },
        { label: 'BMI-for-age (z)', width: '26%' },
        { label: 'Height-for-age (z)', width: '26%' },
      ],
      rows: measures.map((m) => m.cells),
    },
    doses: {
      id: 'doses',
      cols: [
        { label: 'Vaccine', width: '28%' },
        { label: 'Dose', width: '10%' },
        { label: 'Date given', width: '15%' },
        { label: 'Status', width: '14%' },
        { label: 'Remarks', width: '33%' },
      ],
      rows: [...r.vaccineDoses].reverse().map((d) => [
        d.vaccine,
        d.dose,
        mdy(d.givenOn),
        LABELS.dose[d.status],
        d.remarks,
      ]),
    },
    conditions: {
      id: 'conditions',
      cols: [
        { label: 'Condition', width: '28%' },
        { label: 'Status', width: '13%' },
        { label: 'Treatment or medication', width: '32%' },
        { label: 'Date recorded', width: '14%' },
        { label: 'Recorded by', width: '13%' },
      ],
      rows: r.conditions.map((c) => [
        c.condition,
        LABELS.condition[c.status],
        [c.treatment, c.notes].filter(Boolean).join('\n'),
        mdy(c.recordedOn),
        c.by,
      ]),
    },
    slips: {
      id: 'slips',
      cols: [
        { label: 'School year', width: '25%' },
        { label: 'Slip printed', width: '25%' },
        { label: 'Parent meeting attended', width: '50%' },
      ],
      rows: [...r.slips].reverse().map((s) => [
        s.schoolYear,
        s.printedAt ? mdy(s.printedAt) : 'Not printed',
        s.attendedAt ? mdy(s.attendedAt) : 'No',
      ]),
    },
  }

  const card = r.immunizations[0]
  const units: Unit[] = [{ kind: 'head' }]
  const section = (n: number, title: string, id: TableId, empty: string) => {
    units.push({ kind: 'section', n, title })
    const t = tables[id]
    if (t.rows.length === 0) units.push({ kind: 'empty', text: empty })
    else t.rows.forEach((_, i) => units.push({ kind: 'row', table: id, i }))
  }
  section(1, 'Enrolment history', 'classes', 'No enrolment on file.')
  section(2, 'Nutritional status', 'measures', 'No measurements recorded.')
  section(3, 'Immunization', 'doses', 'No vaccines recorded.')
  units.push({
    kind: 'text',
    label: 'Immunization card',
    text: card ? `${CARD[card.status]} (checked ${mdy(card.checkedOn)})` : CARD.none,
  })
  section(4, 'Health history', 'conditions', 'No conditions reported.')
  units.push({ kind: 'text', label: 'Important health notes', text: r.healthNotes || 'None' })
  section(5, 'Invitation slips', 'slips', 'No invitation slips on file.')
  units.push({ kind: 'end' }, { kind: 'sign' })

  return { record: r, school, printedOn: todayIso(), tables, units }
}

/* --- Pages ----------------------------------------------------------------- */

type Page = Unit[]

interface Metrics {
  /** Height of each unit, in `doc.units` order. */
  units: number[]
  /** Height of each table's heading row. */
  thead: Record<TableId, number>
}

function paginate(doc: Doc, m: Metrics): Page[] {
  const room = PAGE.height - FOOT - SLACK
  const pages: Page[] = [[]]
  let used = 0
  const u = doc.units
  /* The cost of a unit where it falls: a row that opens a table on a page
     brings that table's heading row with it. */
  const cost = (i: number, page: Page) => {
    const unit = u[i]
    if (unit.kind !== 'row') return m.units[i]
    const prev = page.at(-1)
    const opens = !(prev && prev.kind === 'row' && prev.table === unit.table)
    return m.units[i] + (opens ? m.thead[unit.table] : 0)
  }
  const newPage = () => {
    pages.push([])
    used = 0
  }

  for (let i = 0; i < u.length; i++) {
    const page = pages.at(-1)!
    const unit = u[i]
    let need = cost(i, page)
    /* A heading stays with what is under it; NOTHING FOLLOWS stays with the
       signatures. */
    if ((unit.kind === 'section' || unit.kind === 'end') && i + 1 < u.length) {
      need += cost(i + 1, [...page, unit])
    }
    if (used + need > room && page.length > 0) {
      newPage()
      i--
      continue
    }
    page.push(unit)
    used += cost(i, page.slice(0, -1))
  }
  return pages.filter((p) => p.length > 0)
}

/* --- Drawing --------------------------------------------------------------- */

function Header({ doc, logo }: { doc: Doc; logo: string }) {
  const { school, record: r } = doc
  const e = r.enrolments[0]
  return (
    <div className="rec-head">
      <div className="rec-letterhead">
        <img src={logo} alt="" width={72} height={72} />
        <div className="rec-school">
          <div>Republic of the Philippines</div>
          <div>Department of Education</div>
          <div>Region {school.region}</div>
          <div>Division of {school.division}</div>
          <div className="rec-school-name">{school.name}</div>
          <div>
            {school.district} District
            {school.schoolId ? ` · School ID ${school.schoolId}` : ''}
          </div>
        </div>
        <span style={{ width: 72 }} />
      </div>
      <h1 className="rec-title">Learner Health and Nutrition Record</h1>
      <table className="rec-info">
        <colgroup>
          <col style={{ width: '18%' }} />
          <col style={{ width: '32%' }} />
          <col style={{ width: '18%' }} />
          <col style={{ width: '32%' }} />
        </colgroup>
        <tbody>
          <tr>
            <th>Name</th>
            <td colSpan={3} className="rec-name">
              {fullName(r)}
            </td>
          </tr>
          <tr>
            <th>LRN</th>
            <td className="rec-mono">{r.lrn}</td>
            <th>Sex</th>
            <td>{r.sex === 'M' ? 'Male' : 'Female'}</td>
          </tr>
          <tr>
            <th>Date of birth</th>
            <td>{mdy(r.birthDate) || '—'}</td>
            <th>{r.archivedAt ? 'Last school year' : 'School year'}</th>
            <td>{e?.schoolYear ?? '—'}</td>
          </tr>
          <tr>
            <th>Status</th>
            <td colSpan={3}>{standing(r)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function TableHead({ t }: { t: Table }) {
  return (
    <>
      <colgroup>
        {t.cols.map((c) => (
          <col key={c.label} style={{ width: c.width }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {t.cols.map((c) => (
            <th key={c.label} style={{ textAlign: c.align ?? 'left' }}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
    </>
  )
}

function Row({ t, i }: { t: Table; i: number }) {
  return (
    <tr data-row>
      {t.rows[i].map((v, k) => (
        <td key={k} style={{ textAlign: t.cols[k].align ?? 'left' }}>
          {v}
        </td>
      ))}
    </tr>
  )
}

function Signatures({ printedOn }: { printedOn: string }) {
  return (
    <div className="rec-sign" data-unit>
      <div>
        <div className="rec-sign-label">Prepared by:</div>
        <div className="rec-sign-line" />
        <div className="rec-sign-role">School nurse</div>
      </div>
      <div>
        <div className="rec-sign-label">Noted by:</div>
        <div className="rec-sign-line" />
        <div className="rec-sign-role">School head</div>
      </div>
      <div className="rec-sign-date">Date issued: {mdy(printedOn)}</div>
    </div>
  )
}

/** One unit, or a run of rows of one table. */
function Block({ doc, logo, units }: { doc: Doc; logo: string; units: Unit[] }) {
  const first = units[0]
  if (first.kind === 'row') {
    const t = doc.tables[first.table]
    return (
      <table className="rec-table" data-table={t.id}>
        <TableHead t={t} />
        <tbody>
          {units.map((u) => (u.kind === 'row' ? <Row key={u.i} t={t} i={u.i} /> : null))}
        </tbody>
      </table>
    )
  }
  switch (first.kind) {
    case 'head':
      return (
        <div data-unit>
          <Header doc={doc} logo={logo} />
        </div>
      )
    case 'section':
      return (
        <h2 className="rec-section" data-unit>
          {first.n}. {first.title}
        </h2>
      )
    case 'empty':
      return (
        <p className="rec-empty" data-unit>
          {first.text}
        </p>
      )
    case 'text':
      return (
        <p className="rec-text" data-unit>
          <b>{first.label}:</b> {first.text}
        </p>
      )
    case 'end':
      return (
        <p className="rec-end" data-unit>
          *** Nothing follows ***
        </p>
      )
    case 'sign':
      return <Signatures printedOn={doc.printedOn} />
  }
}

/** Units grouped so consecutive rows of a table draw as one table. */
function blocks(units: Unit[]): Unit[][] {
  const out: Unit[][] = []
  for (const u of units) {
    const last = out.at(-1)
    const prev = last?.at(-1)
    if (u.kind === 'row' && prev?.kind === 'row' && prev.table === u.table) last!.push(u)
    else out.push([u])
  }
  return out
}

function PageView({
  doc,
  logo,
  page,
  n,
  of,
}: {
  doc: Doc
  logo: string
  page: Page
  n: number
  of: number
}) {
  return (
    <div className="rec-page">
      {blocks(page).map((b, i) => (
        <Block key={i} doc={doc} logo={logo} units={b} />
      ))}
      <div className="rec-foot">
        <span>
          {fullName(doc.record)} · LRN {doc.record.lrn}
        </span>
        <span>
          Page {n} of {of}
        </span>
      </div>
    </div>
  )
}

function Pages({ doc, logo, pages }: { doc: Doc; logo: string; pages: Page[] }) {
  return (
    <div className="rec-doc">
      {pages.map((p, i) => (
        <PageView key={i} doc={doc} logo={logo} page={p} n={i + 1} of={pages.length} />
      ))}
    </div>
  )
}

/** Draws every unit once, off screen at the page's width, and reports the
    heights `paginate` needs. */
function Measure({ doc, logo, onMeasured }: { doc: Doc; logo: string; onMeasured: (m: Metrics) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const done = useRef(onMeasured)
  done.current = onMeasured
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const h = (node: Element | null | undefined) => node?.getBoundingClientRect().height ?? 0
    /* Each block is drawn on its own, so a unit's height is its own. */
    const nodes = [...el.querySelectorAll('[data-unit], tr[data-row]')]
    const thead = {} as Record<TableId, number>
    for (const id of Object.keys(doc.tables) as TableId[]) {
      thead[id] = h(el.querySelector(`table[data-table="${id}"] thead`))
    }
    done.current({ units: nodes.map((n) => h(n)), thead })
  }, [doc, logo])
  return (
    <div
      ref={ref}
      aria-hidden
      style={{ position: 'fixed', left: -100000, top: 0, width: PAGE.width, visibility: 'hidden', pointerEvents: 'none' }}
    >
      <div className="rec-doc">
        {blocks(doc.units).map((b, i) => (
          <Block key={i} doc={doc} logo={logo} units={b} />
        ))}
      </div>
    </div>
  )
}

/* --- The preview ----------------------------------------------------------- */

const DEFAULT_LOGO = `${import.meta.env.BASE_URL}logo.png`

/** The record before it is printed or saved. Opened from the learner
    profile, and from the former learners list. */
export function RecordPreview({ learnerId, onClose }: { learnerId: string; onClose: () => void }) {
  const school = useSchool()
  const logo = school.logoVersion ? schoolLogoUrl(school.logoVersion) : DEFAULT_LOGO

  const [record, setRecord] = useState<ApiLearnerRecord | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    void cached(`learner:${learnerId}`, () => endpoints.learner(learnerId))
      .then(({ learner }) => !cancelled && setRecord(learner))
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [learnerId])

  const doc = useMemo(() => (record ? buildDoc(record, school) : null), [record, school])
  const [pages, setPages] = useState<Page[] | null>(null)
  useEffect(() => setPages(null), [doc])

  /* The sheets are drawn at full size and scaled to the window's width. */
  const area = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.7)
  useEffect(() => {
    const el = area.current
    if (!el) return
    const fit = () => setScale(Math.min(1, (el.clientWidth - 48) / SHEET.width))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /* Set for one render so the pages are in #print-root before the print
     route looks at the page - the same two-step the SF8 uses. */
  const [job, setJob] = useState<'paper' | 'pdf' | null>(null)
  const busy = job !== null
  useEffect(() => {
    if (!job || !doc) return
    let cancelled = false
    /* A timer, not requestAnimationFrame: rAF does not fire while the
       window is hidden or minimised. */
    const id = window.setTimeout(() => {
      if (!cancelled) void run(job, doc)
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job])

  async function run(mode: 'paper' | 'pdf', d: Doc) {
    try {
      /* The logo has to be decoded before the page is laid out, or it
         prints as a gap. */
      const root = document.getElementById('print-root')
      await Promise.all(
        [...(root?.querySelectorAll('img') ?? [])].map((img) => img.decode().catch(() => undefined)),
      )
      if (mode === 'paper') {
        printPaper()
        return
      }
      const res = await savePdf(recordFileName(d.record), 'Save learner record')
      if (res.ok) {
        toast.success(`Saved to ${res.path}`)
        onClose()
      } else if (res.reason === 'unavailable') {
        printPaper()
      } else if (res.reason === 'error') {
        toast.error('The PDF could not be saved. Try again.')
      }
    } finally {
      setJob(null)
    }
  }

  const count = pages?.length ?? 0

  return (
    <ModalContent className="h-[min(94vh,980px)] max-w-[960px]">
      <header className="flex shrink-0 items-start gap-4 px-7 pt-6 pb-4">
        <div className="min-w-0 flex-1">
          <ModalTitle className="font-display text-[19px] leading-tight font-bold tracking-[-0.02em] text-navy-900">
            Learner record preview
            {record ? ` · ${record.lastName}, ${record.firstName}` : ''}
          </ModalTitle>
          <ModalDescription className="mt-1 text-[12.5px] text-muted">
            {failed
              ? 'Unable to load this record.'
              : pages
                ? `${count} ${count === 1 ? 'page' : 'pages'} · Letter, portrait`
                : 'Preparing the pages…'}
          </ModalDescription>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label="Close"
          className="grid size-9 shrink-0 place-items-center rounded-[10px] text-muted transition-colors duration-100 hover:bg-wash hover:text-navy-900"
        >
          <X size={16} weight="bold" />
        </button>
      </header>

      <div ref={area} className="min-h-0 flex-1 overflow-auto bg-wash px-6 py-6">
        {doc && !pages && <Measure doc={doc} logo={logo} onMeasured={(m) => setPages(paginate(doc, m))} />}
        {doc && pages && (
          <div className="flex flex-col items-center gap-6">
            {pages.map((page, i) => (
              <div key={i} className="flex flex-col items-center gap-2">
                <div
                  className="relative overflow-hidden bg-white shadow-[0_8px_24px_-12px_rgba(4,12,36,0.35)]"
                  style={{ width: SHEET.width * scale, height: SHEET.height * scale }}
                >
                  <div
                    className="absolute top-0 left-0 origin-top-left"
                    style={{ width: SHEET.width, height: SHEET.height, padding: MARGIN, transform: `scale(${scale})` }}
                  >
                    <div className="rec-doc">
                      <PageView doc={doc} logo={logo} page={page} n={i + 1} of={pages.length} />
                    </div>
                  </div>
                </div>
                <span className="text-[11px] text-muted">
                  Page {i + 1} of {pages.length}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className="flex shrink-0 items-center gap-2.5 border-t border-line-soft bg-canvas px-7 py-4">
        <Button variant="ghost" className="h-10 px-4 text-[13px]" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <span className="flex-1" />
        {canSavePdf() && (
          <Button
            className="h-10 px-4 text-[13px]"
            icon={<Printer size={15} weight="bold" />}
            onClick={() => setJob('paper')}
            disabled={!pages || busy}
          >
            Print
          </Button>
        )}
        <Button
          variant="primary"
          className="h-10 rounded-[10px] px-5 text-[13px] font-semibold"
          icon={canSavePdf() ? <FilePdf size={15} weight="bold" /> : <Printer size={15} weight="bold" />}
          onClick={() => setJob(canSavePdf() ? 'pdf' : 'paper')}
          disabled={!pages || busy}
        >
          {job === 'pdf' ? 'Saving…' : canSavePdf() ? 'Save PDF' : 'Print'}
        </Button>
      </footer>

      {job && doc && pages && <PrintSheet doc={doc} logo={logo} pages={pages} />}
    </ModalContent>
  )
}

/** The previewed pages in #print-root, for the printer and the PDF. */
function PrintSheet({ doc, logo, pages }: { doc: Doc; logo: string; pages: Page[] }) {
  const host = document.getElementById('print-root')
  if (!host) return null
  return createPortal(<Pages doc={doc} logo={logo} pages={pages} />, host)
}

/** `CHAS-record-DELA-CRUZ-Juan-123456789012.pdf` */
export function recordFileName(r: Pick<ApiLearnerRecord, 'lastName' | 'firstName' | 'lrn'>): string {
  const part = (s: string) => s.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')
  return `CHAS-record-${part(r.lastName).toUpperCase()}-${part(r.firstName)}-${r.lrn}.pdf`
}
