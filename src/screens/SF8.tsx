import { Fragment, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle, FilePdf, Info, Printer, Warning } from '@phosphor-icons/react'
import { AccentButton, BandChip, Button, PILL, PILL_OFF, PILL_ON, Panel, cx } from '../components/ui'
import Sf8FormSheet, { type Sf8Layout } from '../components/Sf8Form'
import { Sf8Preview } from '../components/Sf8Preview'
import { Modal } from '../components/primitives'
import { TODAY, fullName, type Learner } from '../data/mock'
import { useClassNames, useSchool, useSchoolInfo } from '../lib/school-year'
import { useRoster } from '../lib/records'
import { formatDate } from '../lib/dates'
import { ageInMonths, formatAge } from '../lib/nutrition'
import { printPaper, savePdf } from '../lib/print'
import {
  SF8_CAPACITY,
  buildSf8Job,
  canExportSf8,
  computeSf8,
  loadSf8Assets,
  sf8FileName,
  type Sf8Form,
} from '../lib/sf8'
import type { Sf8FormAssets } from '../../electron/sf8-core.mjs'

/* SF8 export. CHAS never transmits: LIS submission stays manual and stays
   with the school.

   TWO WAYS OUT, and they are not the same document.

     The EXPORT is the submission: the SF8 form itself as a PDF, laid out as
     DepEd's worksheet with the learners filled in and age, BMI and the two
     classifications worked out from the workbook's own tables. It used to be
     the .xlsx; a PDF cannot have a cell retyped on the way to the division
     office (the user's call, 2026-10-12). See src/lib/sf8.ts.

     THE REVIEW GATE IS GONE. Exporting used to require a "mark reviewed" tick
     plus a grade with no unmeasured learner, and both were the wrong shape of
     control. The tick was not stored - by design, so it could not go stale -
     which made it a checkbox a person cleared on the way to the button rather
     than a review anybody performed. And a grade is rarely complete: a child
     who was absent all week is a normal Friday, and the head still has to
     hand something in. What the sheet now does instead is write what it has,
     and the banner says how much that is. Checking the form against the
     record book is still the nurse's job; the app had simply been claiming to
     enforce it.

     The PRINTOUT is the working copy. It is this screen's table on paper, for
     the nurse to check against the record book and for the head to sign. It
     carries what CHAS itself computed, so it is captioned as CHAS's own
     figures rather than as the form.

   Neither is transmitted anywhere. The PDF is written to a file the school
   then submits by hand, exactly as it did before this app existed.

   The table is the SF8 form's own column set, so no column can be dropped to
   make it fit - a preview that hides a column is not a preview of the file.
   It keeps a floor width and scrolls sideways inside its panel instead, which
   is the one place in this app horizontal scrolling is the right answer. */

type Note = { tone: 'ok' | 'warn'; text: string }

/* Whose class this grade is, for the form's adviser cell.

   Advisers do not sign in to CHAS, but the form still names the adviser of
   each class. The section list knows who each grade belongs to, so that is
   what the cell carries. */


export default function SF8() {
  const { learners, ready } = useRoster()
  /* Every class the school has, empty ones included (a class with no
     learners has nothing to print, so Print and Export stay off). */
  const grades = useClassNames(learners)
  const { schoolYear, advisers } = useSchoolInfo()

  const [section, setSection] = useState('')
  const [note, setNote] = useState<Note | null>(null)
  const [busy, setBusy] = useState(false)
  /* Set for one render so the sheet is in #print-root before the dialog or
     printToPDF looks at the page - the same two-step the slips screen uses.
     'paper' is the working copy, 'form' the SF8 export. */
  const [job, setJob] = useState<'paper' | 'form' | null>(null)
  const [form, setForm] = useState<{ form: Sf8Form; assets: Sf8FormAssets; layout: Sf8Layout } | null>(null)
  /* Export PDF opens the preview first; Save PDF there exports the pages it
     shows (2026-10-15). */
  const [preview, setPreview] = useState<{ form: Sf8Form; assets: Sf8FormAssets } | null>(null)

  /* The chosen grade has to be one this install actually holds. It starts
     empty because the roster is not loaded on the first render. */
  const current = grades.some((g) => g.name === section) ? section : (grades[0]?.name ?? '')

  const rows = useMemo(
    () =>
      learners
        .filter((l) => l.section === current)
        /* Males first, then females, alphabetical within each - the order
           the SF8 itself is laid out in, so the printed working copy can be
           read down beside the exported SF8 row for row. */
        .sort((a, b) =>
          a.sex === b.sex
            ? fullName(a).localeCompare(fullName(b))
            : a.sex === 'M'
              ? -1
              : 1,
        ),
    [learners, current],
  )
  const missing = rows.filter((l) => !l.measuredOn)
  /* Anything to write, and something to write it with. The grade no longer
     has to be complete - see the note at the top of this file. */
  const canRelease = rows.length > 0 && canExportSf8()

  const assessedOn = useMemo(() => {
    /* The session the sheet reports on: the latest date anything in this
       grade was measured. Today's date would caption an August weigh-in with
       whenever the export happened to be run. */
    const dates = rows.map((l) => l.measuredOn).filter((d): d is string => Boolean(d))
    return dates.sort().at(-1) ?? ''
  }, [rows])

  useEffect(() => {
    if (!job) return
    let cancelled = false
    /* One turn after the effect, so React has committed the sheet into
       #print-root before either print route looks at the page. A timer and
       not requestAnimationFrame, for the reason the slips screen already
       records: rAF does not fire while the window is hidden or minimised,
       and a print that silently never happens is the worst outcome here. */
    const id = window.setTimeout(() => {
      if (!cancelled) void run(job)
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job])

  async function run(mode: 'paper' | 'form') {
    setBusy(true)
    try {
      if (mode === 'paper') {
        printPaper()
        setNote({ tone: 'warn', text: `The print window for the ${current} SF8 is open.` })
        return
      }
      /* The header pictures are data: URLs, but a picture still has to be
         decoded before printToPDF lays the page out or it prints as a gap. */
      const root = document.getElementById('print-root')
      await Promise.all(
        [...(root?.querySelectorAll('img') ?? [])].map((img) => img.decode().catch(() => undefined)),
      )
      /* Named here rather than left to the save dialog, so every sheet the
         school files is called the same thing and sorts by grade and date in
         the folder it lands in. */
      const res = await savePdf(sf8FileName(current, assessedOn || TODAY), 'Save SF8')
      if (res.ok) {
        setPreview(null)
        setNote({
          tone: 'ok',
          text: `Saved the ${current} SF8 to ${res.path}. Submission to LIS is done manually.`,
        })
      } else if (res.reason === 'canceled') {
        setNote(null)
      } else if (res.reason === 'unavailable') {
        setPreview(null)
        printPaper()
        setNote({
          tone: 'warn',
          text: 'Choose “Save as PDF” in the print window to save the SF8.',
        })
      } else {
        setNote({ tone: 'warn', text: 'The PDF could not be saved. Try again.' })
      }
    } finally {
      setJob(null)
      setForm(null)
      setBusy(false)
    }
  }

  async function release() {
    const adviser = advisers[current] ?? ''
    const j = buildSf8Job({ learners: rows, grade: current, adviser, assessedOn })
    if (j.males.length > SF8_CAPACITY || j.females.length > SF8_CAPACITY) {
      setNote({
        tone: 'warn',
        text: `The SF8 has ${SF8_CAPACITY} rows per sex and ${current} has more than that. The grade needs a second sheet.`,
      })
      return
    }
    setBusy(true)
    try {
      const assets = await loadSf8Assets()
      setPreview({ form: computeSf8(j, assets), assets })
    } catch {
      setNote({ tone: 'warn', text: 'The SF8 could not be prepared. Close CHAS and open it again.' })
    } finally {
      setBusy(false)
    }
  }

  /** Save PDF in the preview: the previewed pages go into #print-root, and
      run('form') takes it from there. */
  function save(layout: Sf8Layout) {
    if (!preview) return
    setForm({ ...preview, layout })
    setJob('form')
  }

  if (ready && grades.length === 0) {
    return (
      <div className="h-full px-6 pb-6">
        <Panel title="SF8 export">
          <p className="text-[12px] leading-relaxed text-muted">
            No learners registered.
          </p>
        </Panel>
      </div>
    )
  }

  const males = rows.filter((l) => l.sex === 'M')
  const females = rows.filter((l) => l.sex === 'F')

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-6 pt-1 pb-6">
      {/* --- One bar: a tab per grade level, then Print and Export PDF ----
          The grade list used to be a column of its own beside the table;
          it is a row of tabs since 2026-10-13 (the user's request), so the
          table has the full width, as on the Learners page. */}
      <div className="panel flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-[16px] py-2 pr-2 pl-2.5">
        <div role="tablist" aria-label="Grade level" className="flex flex-wrap gap-1">
          {grades.map((g) => {
            const on = current === g.name
            const inClass = learners.filter((l) => l.section === g.name)
            const pending = inClass.filter((l) => !l.measuredOn).length
            return (
              <button
                key={g.name}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setSection(g.name)}
                title={inClass.length === 0 ? 'No learners' : pending === 0 ? 'All learners measured' : `${pending} not measured`}
                className={cx(PILL, 'h-[34px] px-4 text-[12.5px]', on ? PILL_ON : PILL_OFF)}
              >
                {g.name}
                {/* A tick when everyone is measured, else how many are not. */}
                {inClass.length === 0 ? null : pending === 0 ? (
                  <CheckCircle size={14} weight="fill" className={on ? 'text-white/80' : 'text-n'} />
                ) : (
                  <span className="tnum opacity-70">{pending}</span>
                )}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={() => setJob('paper')} disabled={rows.length === 0 || busy} icon={<Printer size={14} weight="bold" />}>
            Print
          </Button>
          <AccentButton disabled={!canRelease || busy} onClick={() => void release()} icon={<FilePdf size={15} weight="bold" />}>
            Export PDF
          </AccentButton>
        </div>
      </div>

      {/* --- The grade's table ------------------------------------------- */}
      <section className="panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-[18px]">
        <div className="flex shrink-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 pt-4 pb-3">
          <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-navy-900">SF8 · {current}</h2>
          <span className="tnum text-[11.5px] text-muted">
            {rows.length} learners · {males.length} male · {females.length} female
            {assessedOn ? ` · assessed ${formatDate(assessedOn)}` : ''}
          </span>
        </div>

        <div className="shrink-0 space-y-2 px-5 pb-3">
          {/* WHY THE EXPORT BUTTON IS DEAD, said on the page. Browsers
              suppress the tooltip on a disabled control, so a reason given
              only on hover is a reason nobody reads. The export needs to read
              the SF8 template, which takes raw-DEFLATE decompression; every
              browser the school runs has had it since 2022. */}
          {!canExportSf8() && (
            <p className="flex items-start gap-2.5 rounded-[12px] bg-wash px-3.5 py-2.5 text-[12px] leading-relaxed text-muted">
              <Info size={15} weight="fill" className="mt-px shrink-0 text-placeholder" />
              <span>
                <span className="font-semibold text-navy-900">The SF8 cannot be exported in this window.</span> Use Print for the
                table on paper, or export from the installed CHAS app.
              </span>
            </p>
          )}

          {/* What the form will contain, said before it is written. Not a
              gate - the button is live either way - so this reports rather
              than refuses. */}
          <div
            className={cx(
              'flex items-start gap-2.5 rounded-[12px] px-3.5 py-2.5 text-[12px] leading-relaxed',
              missing.length > 0 ? 'bg-gold-100 text-gold-700' : 'bg-[#f2faf5] text-[#14663a]',
            )}
          >
            {missing.length > 0 ? (
              <>
                <Warning size={15} weight="fill" className="mt-px shrink-0" />
                <span>
                  {missing.length} of {rows.length} learner{rows.length > 1 ? 's' : ''} {missing.length > 1 ? 'have' : 'has'} no
                  measurement. Their height, weight and status will be blank.
                </span>
              </>
            ) : (
              <>
                <CheckCircle size={15} weight="fill" className="mt-px shrink-0" />
                <span>All learners in this grade level have been measured. Submission to LIS is done manually.</span>
              </>
            )}
          </div>

          {note && (
            <div
              className={cx(
                'flex items-start gap-2.5 rounded-[12px] px-3.5 py-2.5 text-[11.5px] leading-relaxed',
                note.tone === 'ok' ? 'bg-[#f2faf5] text-[#14663a]' : 'bg-wash text-muted',
              )}
            >
              <span>{note.text}</span>
            </div>
          )}
        </div>

        {/* The SF8's own column set, males first and then females, numbered
            within each as the form numbers them. No column can be dropped to
            make it fit - a preview that hides a column is not a preview of
            the file - so it scrolls sideways below its floor width. */}
        <div className="min-h-0 flex-1 overflow-auto border-t border-line-soft">
          <table className="w-full min-w-[920px] border-collapse text-[12px]">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b border-line-soft">
                {(
                  [
                    ['No.', 'pl-5 w-12'],
                    ['Learner', ''],
                    ['Sex', ''],
                    ['Birth date', ''],
                    ['Age', ''],
                    ['Height', 'text-right'],
                    ['Weight', 'text-right'],
                    ['BMI', 'text-right'],
                    ['BMI-for-age', ''],
                    ['Height-for-age', 'pr-5'],
                  ] as const
                ).map(([label, cls]) => (
                  <th
                    key={label}
                    scope="col"
                    className={cx(
                      'px-2 py-3 text-left text-[10.5px] font-semibold tracking-[0.05em] whitespace-nowrap text-placeholder uppercase',
                      cls,
                    )}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tnum">
              {(
                [
                  ['Male', males],
                  ['Female', females],
                ] as const
              ).map(([label, list]) =>
                list.length === 0 ? null : (
                  <Fragment key={label}>
                    <tr className="bg-wash">
                      <td colSpan={10} className="px-5 py-1.5 text-[11px] font-semibold tracking-[0.04em] text-navy-900 uppercase">
                        {label} <span className="font-normal text-muted">· {list.length}</span>
                      </td>
                    </tr>
                    {list.map((l, i) => {
                      const b = l.heightCm && l.weightKg ? l.weightKg / (l.heightCm / 100) ** 2 : null
                      return (
                        <tr
                          key={l.id}
                          className={cx(
                            'border-b border-line-soft transition-colors duration-100 last:border-b-0',
                            /* An unmeasured learner leaves blanks on the form,
                               so the row says so on its own. Gold, not a status
                               colour: "no measurement" is not a nutritional
                               finding. */
                            l.measuredOn ? 'hover:bg-wash' : 'bg-gold-100/60',
                          )}
                        >
                          <td className="py-2 pr-2 pl-5 text-muted">{i + 1}</td>
                          <td className="px-2 py-2">
                            <span className="block font-semibold whitespace-nowrap text-navy-900">
                              {l.lastName}, {l.firstName} {l.middleName}
                            </span>
                            <span className="block font-mono text-[10.5px] text-muted">{l.lrn}</span>
                          </td>
                          <td className="px-2 py-2 text-muted">{l.sex}</td>
                          <td className="px-2 py-2 whitespace-nowrap text-navy-900">{formatDate(l.birthDate)}</td>
                          <td className="px-2 py-2 whitespace-nowrap text-navy-900">
                            {formatAge(ageInMonths(l.birthDate, l.measuredOn ?? TODAY))}
                          </td>
                          <td className="px-2 py-2 text-right whitespace-nowrap text-navy-900">
                            {l.heightCm === null ? '–' : `${l.heightCm.toFixed(1)} cm`}
                          </td>
                          <td className="px-2 py-2 text-right whitespace-nowrap text-navy-900">
                            {l.weightKg === null ? '–' : `${l.weightKg.toFixed(1)} kg`}
                          </td>
                          <td className="px-2 py-2 text-right font-semibold text-navy-900">{b === null ? '–' : b.toFixed(1)}</td>
                          <td className="px-2 py-2">{l.bmiBand ? <BandChip band={l.bmiBand} dense /> : <span className="text-placeholder">–</span>}</td>
                          <td className="py-2 pr-5 pl-2">
                            {l.hfaBand ? <BandChip band={l.hfaBand} dense /> : <span className="text-placeholder">–</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </Fragment>
                ),
              )}
            </tbody>
          </table>
        </div>
      </section>

      {job === 'paper' && (
        <Sheet
          rows={rows}
          grade={current}
          assessedOn={assessedOn}
          adviser={advisers[current]}
          schoolYear={schoolYear}
        />
      )}
      {job === 'form' && form && <Sf8FormSheet form={form.form} assets={form.assets} layout={form.layout} />}

      <Modal
        open={!!preview}
        onOpenChange={(o) => {
          if (!o && !busy) setPreview(null)
        }}
      >
        {preview && (
          <Sf8Preview
            form={preview.form}
            assets={preview.assets}
            grade={current}
            busy={busy}
            onSave={save}
            onClose={() => setPreview(null)}
          />
        )}
      </Modal>
    </div>
  )
}

/* --- What goes on paper ---------------------------------------------------

   Rendered into #print-root, outside the app tree, so the print stylesheet
   can hide the application and show only this. It is deliberately NOT the
   screen table with a print class on it: the paper wants the school header
   block, a signature line and a caption saying which figures these are, and
   none of those belong on the screen.
-------------------------------------------------------------------------- */

function Sheet({
  rows,
  grade,
  assessedOn,
  adviser,
  schoolYear,
}: {
  rows: Learner[]
  grade: string
  assessedOn: string
  adviser: string | undefined
  schoolYear: string
}) {
  const school = useSchool()
  const host = document.getElementById('print-root')
  if (!host) return null

  const cell = 'border border-[#9aa6bb] px-1.5 py-[3px] align-middle'

  return createPortal(
    <div className="print-doc bg-white text-[9.5pt] text-black">
      <div className="mb-2 text-center">
        <div className="text-[11pt] font-bold tracking-[0.04em] uppercase">{school.name}</div>
        <div className="text-[8.5pt]">
          {school.district} District &middot; Division of {school.division} &middot; Region{' '}
          {school.region}
        </div>
        <div className="mt-1 text-[10pt] font-semibold">
          School Form 8 &ndash; Learner Basic Health and Nutrition Report
        </div>
      </div>

      <div className="mb-1.5 flex flex-wrap justify-between gap-x-6 text-[8.5pt]">
        <span>
          <b>Grade and section:</b> {grade}
        </span>
        <span>
          <b>School year:</b> {schoolYear}
        </span>
        <span>
          <b>Date of assessment:</b> {assessedOn || '__________'}
        </span>
        <span>
          <b>Adviser:</b> {adviser ?? '__________'}
        </span>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-[#e8edf6] text-[8pt] uppercase">
            <th className={cell}>#</th>
            <th className={cell}>LRN</th>
            <th className={cx(cell, 'text-left')}>Name (Last, First, Middle)</th>
            <th className={cell}>Sex</th>
            <th className={cell}>Birth date</th>
            <th className={cell}>Height (cm)</th>
            <th className={cell}>Weight (kg)</th>
            <th className={cell}>BMI</th>
            <th className={cell}>BMI-for-age</th>
            <th className={cell}>Height-for-age</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l, i) => (
            <tr key={l.id}>
              <td className={cx(cell, 'text-center')}>{i + 1}</td>
              <td className={cx(cell, 'text-center font-mono text-[8pt]')}>{l.lrn}</td>
              <td className={cx(cell, 'whitespace-nowrap')}>
                {l.lastName}, {l.firstName} {l.middleName}
              </td>
              <td className={cx(cell, 'text-center')}>{l.sex}</td>
              <td className={cx(cell, 'text-center')}>{l.birthDate}</td>
              <td className={cx(cell, 'text-right')}>{l.heightCm ?? ''}</td>
              <td className={cx(cell, 'text-right')}>{l.weightKg ?? ''}</td>
              <td className={cx(cell, 'text-right')}>
                {l.heightCm && l.weightKg ? (l.weightKg / (l.heightCm / 100) ** 2).toFixed(1) : ''}
              </td>
              <td className={cx(cell, 'text-center')}>{l.bmiBand ?? ''}</td>
              <td className={cx(cell, 'text-center')}>{l.hfaBand ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* What this piece of paper is, so it is never mistaken for the
          submitted SF8. */}
      <p className="mt-2 text-[7.5pt] leading-snug">
        Working copy. Nutritional status is computed by CHAS using the WHO 2007 reference; the
        official SF8 uses DepEd&rsquo;s own tables. Blank rows are learners not
        measured.
      </p>

      <div className="mt-8 flex justify-between text-[8.5pt]">
        <span className="w-[46%] border-t border-black pt-1 text-center">
          Class adviser / School nurse
        </span>
        <span className="w-[46%] border-t border-black pt-1 text-center">School head</span>
      </div>
    </div>,
    host,
  )
}
