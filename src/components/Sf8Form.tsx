import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { BMI_BANDS, HFA_BANDS, type Sf8Form, type Sf8FormRow } from '../lib/sf8'
import type { Sf8FormAssets } from '../../electron/sf8-core.mjs'

/* The SF8 as the PDF export draws it.

   This is the school's SF8 worksheet ("Nutritional Status") laid out cell
   for cell: the same fifteen columns in the same proportions, the same
   merges, one row per learner under each sex, the summary table and the signature
   lines. Rows 127 onward are the form author's notes, marked "NOT included
   in printing" on the sheet itself, so they are left off here too.

   It is rendered into #print-root like every other printout, and takes the
   named page `sf8form` from index.css: long bond paper (8.5in x 13in)
   landscape with quarter-inch margins, the paper the form was designed for.
   On A4 the sheet had to shrink to 91% to fit across, which read as small
   (the user's call, 2026-10-12); on long bond it sits at full size.

   The title block is the one place it departs from the sheet's cells: the
   seal, the title and the DepEd wordmark are set as one centred group, a
   size up from the sheet's, rather than with the pictures pinned to the far
   corners (also the user's call, the same day).

   THE PAGES ARE LAID OUT HERE, NOT BY THE PRINTER (2026-10-15). Left to
   Chromium, a class that did not quite fit sent the whole summary table to
   a page of its own. Now every part is measured once (Sf8Measure) and
   `paginate` decides the pages, and the preview and the PDF draw those same
   pages, so what the preview shows is what the file holds:
     - a form that nearly fits one page is scaled down to fit it, so the
       summary stays under the list;
     - a longer one runs at full size over several pages, the column header
       on each, and the summary is never left on a page alone - the last
       learners move over with it.
   The list ends in a NOTHING FOLLOWS row, so nothing can be added under the
   last learner after the form is signed. */

/** Column widths A-O from the template, in Excel's character units. */
const COLS = [
  3.6640625, 15.109375, 6.88671875, 6.88671875, 8.5546875, 6.5546875, 14, 7.33203125, 10.5546875,
  9.5546875, 9.109375, 8.88671875, 14.33203125, 14.88671875, 21.44140625,
]
/** Excel's own character-to-pixel rule for Calibri 11. */
const PX = COLS.map((w) => w * 7 + 5)
const TOTAL_PX = PX.reduce((a, b) => a + b, 0)
const pct = (px: number) => `${((px / TOTAL_PX) * 100).toFixed(4)}%`

/** Long bond landscape less 0.25in margins, at 96 px to the inch, over the
    sheet's natural width: everything in points is scaled by it. Just over 1,
    so the form fills the page at its own size. */
const SCALE = ((13 - 0.5) * 96) / TOTAL_PX
const pt = (n: number) => `${(n * SCALE).toFixed(2)}pt`

/** The printable area of one page, in CSS pixels: long bond landscape less
    the quarter-inch margins of `@page sf8form`. */
export const SF8_PAGE = { width: 12.5 * 96, height: 8 * 96 }

/** The smallest a one-page form is scaled to. Below this the text is too
    small to read off paper, and the form runs over more pages instead. */
const MIN_ZOOM = 0.7

/** The form's 0.00 format. Rounded at fifteen digits first, as Excel does,
    so 1.005 shows as 1.01 rather than the 1.00 of its binary value. */
function fix2(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return ''
  return (Math.round(Number((n * 100).toPrecision(15))) / 100).toFixed(2)
}

/** The header says MM/DD/YYYY, so that is what the dates are, whatever the
    machine's locale. */
function mdy(iso: string): string {
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${m}/${d}/${y}` : ''
}

function Cols() {
  return (
    <colgroup>
      {PX.map((px, i) => (
        <col key={i} style={{ width: pct(px) }} />
      ))}
    </colgroup>
  )
}

/** One table row at the template's row height. */
function Row({ ht, children, className }: { ht: number; children?: ReactNode; className?: string }) {
  return (
    <tr className={className} style={{ height: pt(ht) }}>
      {children}
    </tr>
  )
}

function Td({
  span = 1,
  rows,
  className,
  size = 11,
  children,
}: {
  span?: number
  rows?: number
  className?: string
  size?: number
  children?: ReactNode
}) {
  return (
    <td colSpan={span > 1 ? span : undefined} rowSpan={rows} className={className} style={{ fontSize: pt(size) }}>
      {children}
    </td>
  )
}

/* --- What goes down the list ------------------------------------------- */

export type Sf8Item =
  | { kind: 'sex'; label: 'MALE' | 'FEMALE' }
  | { kind: 'learner'; n: number; row: Sf8FormRow }
  | { kind: 'end' }

export interface Sf8Page {
  /** The title block and the school header; the first page only. */
  title: boolean
  items: Sf8Item[]
  /** The summary table and the signature lines; the last page only. */
  closing: boolean
}

export interface Sf8Layout {
  /** CSS zoom on the whole form: 1, or less when it is fitted to one page. */
  zoom: number
  pages: Sf8Page[]
}

/** The list, top to bottom: each sex under its heading, numbered within it.
    A sex with no learners is just its heading. */
export function sf8Items(form: Sf8Form): Sf8Item[] {
  return [
    { kind: 'sex', label: 'MALE' },
    ...form.males.map((row, i) => ({ kind: 'learner' as const, n: i + 1, row })),
    { kind: 'sex', label: 'FEMALE' },
    ...form.females.map((row, i) => ({ kind: 'learner' as const, n: i + 1, row })),
    { kind: 'end' },
  ]
}

/** Everything on one page at full size: what is measured, and the fallback. */
export function onePage(form: Sf8Form): Sf8Layout {
  return { zoom: 1, pages: [{ title: true, items: sf8Items(form), closing: true }] }
}

/** The measured height of each part, in CSS pixels at full size. */
export interface Sf8Metrics {
  title: number
  thead: number
  items: number[]
  closing: number
}

/** Splits the form into pages. See the note at the top of this file. */
export function paginate(form: Sf8Form, m: Sf8Metrics): Sf8Layout {
  const items = sf8Items(form)
  const P = SF8_PAGE.height
  const total = m.title + m.thead + m.items.reduce((a, b) => a + b, 0) + m.closing

  /* One page, scaled if it must be. A hair under the exact fit, so rounding
     in the printer cannot push the last line onto a second sheet. */
  if (total <= P) return { zoom: 1, pages: [{ title: true, items, closing: true }] }
  if (P / total >= MIN_ZOOM) {
    return { zoom: Math.floor((P / total) * 0.985 * 1000) / 1000, pages: [{ title: true, items, closing: true }] }
  }

  const pages: Sf8Page[] = []
  let cur: Sf8Page = { title: true, items: [], closing: false }
  let curH: number[] = []
  let used = m.title + m.thead
  items.forEach((item, i) => {
    /* A sex heading is never the last line of a page: it goes over with the
       first learner under it. */
    const need = m.items[i] + (item.kind === 'sex' && i + 1 < items.length ? m.items[i + 1] : 0)
    if (used + need > P && cur.items.length > 0) {
      pages.push(cur)
      cur = { title: false, items: [], closing: false }
      curH = []
      used = m.thead
    }
    cur.items.push(item)
    curH.push(m.items[i])
    used += m.items[i]
  })

  /* The summary goes under the last line if it fits there. If not, the last
     learners move to the next page with it, so the summary never stands on
     a page by itself - at most half the page's lines, so the page they leave
     is not left nearly empty either. */
  if (used + m.closing <= P) {
    cur.closing = true
    pages.push(cur)
  } else {
    const next: Sf8Page = { title: false, items: [], closing: true }
    let nextUsed = m.thead + m.closing
    const most = Math.max(1, Math.floor(cur.items.length / 2))
    while (cur.items.length > 1 && next.items.length < most && nextUsed + curH[curH.length - 1] <= P) {
      nextUsed += curH.pop()!
      next.items.unshift(cur.items.pop()!)
    }
    /* A heading left at the foot of the page follows its learners over. */
    while (cur.items.length > 1 && cur.items[cur.items.length - 1].kind === 'sex') {
      next.items.unshift(cur.items.pop()!)
      curH.pop()
    }
    pages.push(cur, next)
  }
  return { zoom: 1, pages }
}

/* --- The parts ---------------------------------------------------------- */

function LearnerRow({ n, row, last }: { n: number; row: Sf8FormRow; last: boolean }) {
  const bottom = last ? ' Bb' : ''
  return (
    <Row ht={16.5}>
      <Td className={`in c arial Bl${bottom}`}>{n}</Td>
      <Td className={`in arial${bottom}`}>{row.lrn}</Td>
      <Td span={4} className={`in arial name${bottom}`} size={10}>
        {row.name}
      </Td>
      <Td className={`in c${bottom}`}>{mdy(row.birthDate)}</Td>
      <Td className={`c${bottom}`}>{fix2(row.age)}</Td>
      <Td className={`in c${bottom}`}>{fix2(row.weightKg)}</Td>
      <Td className={`in c${bottom}`}>{fix2(row.heightM)}</Td>
      <Td className={`c${bottom}`}>{fix2(row.heightSq)}</Td>
      <Td className={`c${bottom}`}>{fix2(row.bmi)}</Td>
      <Td className={`c${bottom}`}>{row.bmiCategory}</Td>
      <Td className={`c${bottom}`}>{row.hfa}</Td>
      <Td className={`l Br${bottom}`} />
    </Row>
  )
}

function SexRow({ label }: { label: 'MALE' | 'FEMALE' }) {
  return (
    <Row ht={label === 'MALE' ? 14.25 : 16.5}>
      <Td span={2} className="sex Bl Bt Bb">
        {label}
      </Td>
      <Td span={4} className="Bt Bb" />
      {Array.from({ length: 8 }, (_, i) => (
        <Td key={i} className="Bt Bb" />
      ))}
      <Td className="Br Bt Bb" />
    </Row>
  )
}

/** Enough hyphens to cross half the sheet; the cell clips the rest. */
const DASHES = '-'.repeat(300)

/** The line under the list: ----- NOTHING FOLLOWS ----- across the full
    width, as the user wrote it, set just below the table rather than inside
    it (both 2026-10-15). The dashes are typed characters, not a rule, so the
    line reads the same on any printer. */
function EndLine() {
  return (
    <div className="sf8-end-line" style={{ height: pt(16.5), fontSize: pt(11) }}>
      <span className="sf8-end">
        <span className="sf8-dash sf8-dash-l">{DASHES}</span>
        <span>NOTHING FOLLOWS</span>
        <span className="sf8-dash">{DASHES}</span>
      </span>
    </div>
  )
}

function Item({ item, last }: { item: Exclude<Sf8Item, { kind: 'end' }>; last: boolean }) {
  if (item.kind === 'sex') return <SexRow label={item.label} />
  return <LearnerRow n={item.n} row={item.row} last={last} />
}

function Title({ form, pictures }: { form: Sf8Form; pictures: { seal: string; wordmark: string } }) {
  const h = form.job.header
  return (
    <>
      <div className="sf8-title">
        <span className="sf8-code">SF 8</span>
        <img src={pictures.seal} alt="" className="sf8-seal" />
        <div className="sf8-heading">
          <div className="sf8-dept">Department of Education</div>
          <div className="sf8-name">
            School Form 8 Learner&rsquo;s Basic Health and Nutrition Report (SF8)
          </div>
          <div className="sf8-levels">(For All Grade Levels)</div>
        </div>
        <img src={pictures.wordmark} alt="" className="sf8-wordmark" />
      </div>

      <div>
        <table>
          <Cols />
          <tbody>
            <Row ht={19.5}>
              <Td span={2} />
              <Td span={2} className="r" size={12}>
                School Name
              </Td>
              <Td span={3} className="c box" size={9}>
                {h.schoolName}
              </Td>
              <Td className="r">District</Td>
              <Td span={2} className="c box">
                {h.district}
              </Td>
              <Td className="r">Division</Td>
              <Td span={2} className="c box">
                {h.division}
              </Td>
              <Td className="r">Region</Td>
              <Td className="c box">{h.region}</Td>
            </Row>
            <Row ht={6.75} />
            <Row ht={24}>
              <Td span={2} className="r" size={12}>
                School ID
              </Td>
              <Td span={2} className="c box" size={12}>
                {h.schoolId}
              </Td>
              <Td className="r">Grade </Td>
              <Td className="c box">{h.grade}</Td>
              <Td className="r">Section</Td>
              <Td span={2} className="c box">
                {h.section}
              </Td>
              <Td span={2} className="r bl">
                Track/Strand (SHS)
              </Td>
              <Td span={2} className="c box">
                {h.track}
              </Td>
              <Td className="r">School Year</Td>
              <Td className="c box">{h.schoolYear}</Td>
            </Row>
            <Row ht={6} />
          </tbody>
        </table>
      </div>
    </>
  )
}

/** The column header, repeated at the top of the list on every page. */
function Head() {
  return (
    <thead>
      <Row ht={16.5}>
        <Td rows={2} className="c Bl Bt Bb">
          No.
        </Td>
        <Td rows={2} className="c bold Bt Bb">
          LRN
        </Td>
        <Td span={4} rows={2} className="c bold wrap Bt Bb">
          Learner&rsquo;s Name
          <br />
          (Last Name, First Name, Name Extension, Middle Name)
        </Td>
        <Td rows={2} className="c bold wrap Bt Bb">
          Birthdate
          <br />
          (MM/DD/YYYY)
        </Td>
        <Td rows={2} className="c bold Bt Bb">
          Age
        </Td>
        <Td rows={2} className="c bold wrap Bt Bb">
          Weight
          <br />
          (kg)
        </Td>
        <Td rows={2} className="c bold wrap Bt Bb">
          Height
          <br />
          (m)
        </Td>
        <Td rows={2} className="c bold wrap Bt Bb">
          Height² (m²)
        </Td>
        <Td span={2} className="c bold Bt">
          Nutritional Status
        </Td>
        <Td rows={2} className="c bold wrap Bt Bb">
          Height for Age (HFA)
        </Td>
        <Td rows={2} className="c bold Br Bt Bb">
          Remarks
        </Td>
      </Row>
      <Row ht={16.5}>
        <Td className="c bold wrap Bb">BMI (kg/m²)</Td>
        <Td className="c bold wrap Bb">BMI Category</Td>
      </Row>
    </thead>
  )
}

function Closing({ form }: { form: Sf8Form }) {
  const { bmi, hfa } = form.summary
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const both = (a: number[], b: number[]) => a.map((x, i) => x + b[i])
  return (
    <table className="closing">
      <Cols />
      <tbody>
        <Row ht={14.25} />
        <Row ht={16.5}>
          <Td span={15} className="c bold" size={14}>
            SUMMARY TABLE
          </Td>
        </Row>
        <Row ht={14.25} />
        <Row ht={31.5}>
          <Td span={2} rows={2} className="c bold Bl Bt bb">
            SEX
          </Td>
          <Td span={7} className="c bold wrap Bl Bt Bb">
            Nutritional Status
            <br />
            Summary Table
          </Td>
          <Td span={6} className="c bold wrap Bl Br Bt Bb">
            Height for Age (HFA)
            <br />
            Summary Table
          </Td>
        </Row>
        <Row ht={33}>
          {BMI_BANDS.map((band, i) => (
            <Td key={band} span={i === 0 ? 2 : 1} className={`c bold wrap ${i === 0 ? 'Bl' : ''}`}>
              {band}
            </Td>
          ))}
          <Td className="c bold Br">TOTAL</Td>
          {HFA_BANDS.map((band) => (
            <Td key={band} className="c bold wrap">
              {band}
            </Td>
          ))}
          <Td span={2} className="c bold Br">
            Total
          </Td>
        </Row>
        {(
          [
            ['MALE', bmi.male, hfa.male],
            ['FEMALE', bmi.female, hfa.female],
            ['TOTAL', both(bmi.male, bmi.female), both(hfa.male, hfa.female)],
          ] as const
        ).map(([label, b, s]) => {
          const end = label === 'TOTAL' ? ' Bb' : ''
          return (
            <Row key={label} ht={16.5}>
              <Td span={2} className={`bold Bl${end}`}>
                {label}
              </Td>
              {b.map((n, i) => (
                <Td key={i} span={i === 0 ? 2 : 1} className={`c${i === 0 ? ' Bl' : ''}${label === 'TOTAL' ? ' bold' : ''}${end}`}>
                  {n}
                </Td>
              ))}
              <Td className={`c bold Br${end}`}>{sum(b)}</Td>
              {s.map((n, i) => (
                <Td key={i} className={`c${label === 'TOTAL' ? ' bold' : ''}${end}`}>
                  {n}
                </Td>
              ))}
              <Td span={2} className={`c bold Br${end}`}>
                {sum(s)}
              </Td>
            </Row>
          )
        })}
        <Row ht={16.5} />
        <Row ht={16.5}>
          <Td span={4} className="l">
            Date of Assessment:
          </Td>
          <Td span={4} className="l">
            Conducted/Assessed By:
          </Td>
          <Td span={4} className="l">
            Certified Correct By:
          </Td>
          <Td span={3} className="l">
            Reviewed By:
          </Td>
        </Row>
        <Row ht={16.5} />
        {/* The three signature lines are left for the people who sign this
            copy, as the workbook export left them. */}
        <Row ht={16.5}>
          <Td span={3} className="c bb">
            {mdy(form.job.assessedOn)}
          </Td>
          <Td />
          <Td span={3} className="bb" />
          <Td />
          <Td span={3} className="bb" />
          <Td />
          <Td span={3} className="bb" />
        </Row>
        <Row ht={16.5} />
        <Row ht={16.5}>
          <Td span={13} />
          <Td className="r ital" size={9}>
            SFRT 2017
          </Td>
          <Td />
        </Row>
      </tbody>
    </table>
  )
}

/* A data: URL rather than an object URL: nothing to revoke, and the picture
   is in the page the moment the sheet is, which printToPDF needs. */
function dataUrl(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return `data:image/jpeg;base64,${btoa(bin)}`
}

function usePictures(assets: Sf8FormAssets) {
  return useMemo(() => ({ seal: dataUrl(assets.seal), wordmark: dataUrl(assets.wordmark) }), [assets])
}

/** One page of the form. */
export function Sf8PageView({
  form,
  assets,
  page,
}: {
  form: Sf8Form
  assets: Sf8FormAssets
  page: Sf8Page
}) {
  const pictures = usePictures(assets)
  const rows = page.items.filter((i): i is Exclude<Sf8Item, { kind: 'end' }> => i.kind !== 'end')
  return (
    <div className="sf8-page">
      {page.title && <Title form={form} pictures={pictures} />}
      {rows.length > 0 && (
        <table className="learners">
          <Cols />
          <Head />
          <tbody>
            {rows.map((item, i) => (
              <Item key={i} item={item} last={i === rows.length - 1} />
            ))}
          </tbody>
        </table>
      )}
      {page.items.some((i) => i.kind === 'end') && <EndLine />}
      {page.closing && <Closing form={form} />}
    </div>
  )
}

/** The whole form, page after page, as it goes into the PDF. */
export function Sf8Pages({ form, assets, layout }: { form: Sf8Form; assets: Sf8FormAssets; layout: Sf8Layout }) {
  return (
    <div className="sf8-form" style={{ zoom: layout.zoom }}>
      {layout.pages.map((page, i) => (
        <Sf8PageView key={i} form={form} assets={assets} page={page} />
      ))}
    </div>
  )
}

/** Draws the form once, off screen at the page's own width, and reports how
    tall each part is. `paginate` turns that into pages. */
export function Sf8Measure({
  form,
  assets,
  onMeasured,
}: {
  form: Sf8Form
  assets: Sf8FormAssets
  onMeasured: (m: Sf8Metrics) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const done = useRef(onMeasured)
  done.current = onMeasured
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let cancelled = false
    /* The title's height depends on its pictures, so they are decoded
       before anything is measured. */
    void Promise.all([...el.querySelectorAll('img')].map((img) => img.decode().catch(() => undefined))).then(() => {
      if (cancelled) return
      const h = (node: Element | null) => node?.getBoundingClientRect().height ?? 0
      const learners = el.querySelector('table.learners')
      const titleH = h(el.querySelector('.sf8-title')) + h(el.querySelector('.sf8-title + div'))
      /* The rows are table rows in list order; the end line sits below. */
      const trs = [...(learners?.querySelectorAll('tbody > tr') ?? [])]
      let r = 0
      done.current({
        title: titleH,
        thead: h(learners?.querySelector('thead') ?? null),
        items: sf8Items(form).map((item) => (item.kind === 'end' ? h(el.querySelector('.sf8-end-line')) : h(trs[r++] ?? null))),
        closing: h(el.querySelector('table.closing')),
      })
    })
    return () => {
      cancelled = true
    }
  }, [form, assets])
  return (
    <div
      ref={ref}
      aria-hidden
      style={{ position: 'fixed', left: -100000, top: 0, width: SF8_PAGE.width, visibility: 'hidden', pointerEvents: 'none' }}
    >
      <Sf8Pages form={form} assets={assets} layout={onePage(form)} />
    </div>
  )
}

/** The form in #print-root, for the PDF. */
export default function Sf8FormSheet({
  form,
  assets,
  layout,
}: {
  form: Sf8Form
  assets: Sf8FormAssets
  layout: Sf8Layout
}) {
  const host = document.getElementById('print-root')
  if (!host) return null
  return createPortal(<Sf8Pages form={form} assets={assets} layout={layout} />, host)
}
