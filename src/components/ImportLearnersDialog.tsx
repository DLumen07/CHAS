import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { CheckCircle, DownloadSimple, FileArrowUp, FileText, Info, Warning, X } from '@phosphor-icons/react'
import { Button, cx } from './ui'
import { Fieldset, REQ } from './form'
import { ModalContent, ModalDescription, ModalTitle } from './primitives'
import { toast } from './toast'
import { ApiError, endpoints, type ApiEnrolmentOptions, type ImportLearnerRow } from '../lib/api'
import { readSpreadsheet, templateCsv, toClassList, type ClassListRow } from '../lib/class-list'
import { refresh } from '../lib/server-records'
import { useRoster } from '../lib/records'
import { formatDate } from '../lib/dates'

/* Adding a whole class from a spreadsheet.

   One page: the class, the file, then a preview of every row the file holds
   with what will happen to it. Nothing is saved until "Import" is pressed,
   and only the rows marked Ready are sent. The class is chosen once for the
   whole file, as an SF1 is one class.

   Immunization is not part of a class list, so imported learners start with
   no card on file; the note above the button says where to add it. */

type Status = 'ready' | 'registered' | 'problem'

export function ImportLearnersDialog({
  section,
  onDone,
}: {
  /** The class the roster currently has open. The dialog's default. */
  section: string
  onDone: () => void
}) {
  const { learners: roster } = useRoster()
  const [options, setOptions] = useState<ApiEnrolmentOptions | null>(null)
  const [sectionId, setSectionId] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [rows, setRows] = useState<ClassListRow[] | null>(null)
  const [reading, setReading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [done, setDone] = useState<{ added: number; skipped: number } | null>(null)
  const input = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let cancelled = false
    void endpoints
      .enrolmentOptions()
      .then((o) => {
        if (cancelled) return
        setOptions(o)
        const opening = o.sections.find((s) => s.name === section) ?? o.sections[0]
        if (opening) setSectionId(opening.id)
      })
      .catch(() => {
        if (!cancelled) setFailure('Unable to load the class list. Close this window and open it again.')
      })
    return () => {
      cancelled = true
    }
  }, [section])

  const known = useMemo(() => new Set(roster.map((l) => l.lrn)), [roster])
  const statusOf = (r: ClassListRow): Status =>
    r.problem ? 'problem' : known.has(r.learner.lrn) ? 'registered' : 'ready'

  const counts = { ready: 0, registered: 0, problem: 0 }
  for (const r of rows ?? []) counts[statusOf(r)]++

  async function read(file: File) {
    setFailure(null)
    setReading(true)
    try {
      const list = toClassList(await readSpreadsheet(file))
      if (list.length === 0) throw new Error('No learners were found in the file.')
      setRows(list)
      setFileName(file.name)
    } catch (err) {
      setRows(null)
      setFileName(null)
      setFailure(err instanceof Error ? err.message : 'The file could not be read.')
    } finally {
      setReading(false)
      if (input.current) input.current.value = ''
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) void read(file)
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([templateCsv()], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'class-list-template.csv'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function save() {
    if (!rows) return
    /* A Ready row has passed every check, its sex included. */
    const ready = rows.filter((r) => statusOf(r) === 'ready').map((r) => r.learner as ImportLearnerRow)
    if (ready.length === 0) return
    setFailure(null)
    setBusy(true)
    try {
      let added = 0
      let skipped = 0
      /* The server takes a hundred at a time; an SF1 is well under that. */
      for (let i = 0; i < ready.length; i += 100) {
        const res = await endpoints.importLearners({ sectionId, learners: ready.slice(i, i + 100) })
        added += res.added
        skipped += res.skipped.length
      }
      await refresh()
      toast.success(`${added} ${added === 1 ? 'learner was' : 'learners were'} imported.`)
      setDone({ added, skipped: skipped + counts.registered })
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : 'Unable to import the learners.')
    } finally {
      setBusy(false)
    }
  }

  const className = options?.sections.find((s) => s.id === sectionId)?.name ?? ''

  /* --- Imported --------------------------------------------------------- */

  if (done) {
    return (
      <ModalContent className="max-w-[520px]">
        <ModalTitle className="sr-only">Learners imported</ModalTitle>
        <ModalDescription className="sr-only">{done.added} learners were imported.</ModalDescription>
        <div className="px-8 pt-9 pb-8 text-center">
          <div className="mx-auto grid size-14 place-items-center rounded-full bg-[#e6f4ec]">
            <CheckCircle size={30} weight="fill" className="text-[var(--color-n)]" />
          </div>
          <h2 className="mt-4 font-display text-[22px] font-bold tracking-[-0.025em] text-navy-900">
            {done.added} {done.added === 1 ? 'learner' : 'learners'} imported
          </h2>
          <p className="mx-auto mt-2 max-w-[44ch] text-[12.5px] leading-relaxed text-muted">
            Enrolled in {className} for {options?.schoolYear}.
            {done.skipped > 0 && ` ${done.skipped} already registered ${done.skipped === 1 ? 'was' : 'were'} skipped.`}{' '}
            Add each learner's immunization from the profile.
          </p>
          <Button
            variant="primary"
            className="mt-7 h-11 justify-center rounded-[12px] px-6 text-[13px] font-semibold"
            onClick={onDone}
          >
            Back to learners
          </Button>
        </div>
      </ModalContent>
    )
  }

  /* --- The form --------------------------------------------------------- */

  return (
    <ModalContent
      className="h-[min(92vh,720px)] max-w-[760px]"
      onEscapeKeyDown={(e) => busy && e.preventDefault()}
      onPointerDownOutside={(e) => e.preventDefault()}
    >
      <header className="shrink-0 px-7 pt-6">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <ModalTitle className="font-display text-[19px] leading-tight font-bold tracking-[-0.02em] text-navy-900">
              Import learners
            </ModalTitle>
            <ModalDescription className="mt-1 text-[12.5px] text-muted">
              Add a class from a spreadsheet.
            </ModalDescription>
          </div>
          <button
            type="button"
            onClick={onDone}
            disabled={busy}
            aria-label="Close"
            className="grid size-9 shrink-0 place-items-center rounded-[10px] text-muted transition-colors duration-100 hover:bg-wash hover:text-navy-900"
          >
            <X size={16} weight="bold" />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-7 pt-5 pb-6">
        <Fieldset label={<>Class{REQ}</>}>
          <div role="radiogroup" aria-label="Class" className="grid grid-cols-3 gap-2.5 sm:grid-cols-6">
            {options?.sections.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={sectionId === s.id}
                onClick={() => setSectionId(s.id)}
                className={cx(
                  'h-11 truncate rounded-[10px] px-2 text-[12.5px] font-semibold transition-[box-shadow,background,color] duration-100',
                  sectionId === s.id
                    ? 'bg-navy-50 text-navy-900 shadow-[inset_0_0_0_2px_var(--color-navy-900)]'
                    : 'text-navy-900 shadow-[inset_0_0_0_1px_var(--color-line)] hover:shadow-[inset_0_0_0_1px_#c2cddd]',
                )}
              >
                {s.name === s.gradeName ? s.name : `${s.gradeName} · ${s.name}`}
              </button>
            ))}
          </div>
        </Fieldset>

        <input
          ref={input}
          type="file"
          accept=".xlsx,.csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void read(file)
          }}
        />

        <div className="mt-5">
          <Fieldset label={<>File{REQ}</>}>
            {rows ? (
              <div className="flex items-center gap-3 rounded-[12px] bg-wash px-4 py-3">
                <FileText size={20} weight="duotone" className="shrink-0 text-navy-700" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-navy-900">{fileName}</p>
                  <p className="text-[11.5px] text-muted">
                    {rows.length} {rows.length === 1 ? 'row' : 'rows'} &middot;{' '}
                    <span className="font-semibold text-[var(--color-n)]">{counts.ready} ready</span>
                    {counts.registered > 0 && <> &middot; {counts.registered} already registered</>}
                    {counts.problem > 0 && (
                      <>
                        {' '}
                        &middot; <span className="font-semibold text-[#9f1239]">{counts.problem} cannot be imported</span>
                      </>
                    )}
                  </p>
                </div>
                <Button onClick={() => input.current?.click()} disabled={busy || reading}>
                  Change file
                </Button>
              </div>
            ) : (
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={cx(
                  'flex flex-col items-center rounded-[14px] border-2 border-dashed px-6 py-9 text-center transition-colors duration-100',
                  dragging ? 'border-navy-700 bg-navy-50' : 'border-line',
                )}
              >
                <FileArrowUp size={30} weight="duotone" className="text-navy-700" />
                <Button
                  variant="primary"
                  className="mt-3 h-10 rounded-[10px] px-5 text-[13px] font-semibold"
                  onClick={() => input.current?.click()}
                  disabled={reading}
                >
                  {reading ? 'Reading…' : 'Choose file'}
                </Button>
                <p className="mt-3 max-w-[52ch] text-[12px] leading-relaxed text-muted">
                  Excel (.xlsx) or CSV. The SF1 from LIS can be used as it is. The file needs LRN, name, sex
                  and birth date columns.
                </p>
                <button
                  type="button"
                  onClick={downloadTemplate}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium text-navy-700 hover:bg-wash hover:text-navy-900"
                >
                  <DownloadSimple size={13} weight="bold" />
                  Download a blank template
                </button>
              </div>
            )}
          </Fieldset>
        </div>

        {rows && (
          <div className="mt-4 overflow-hidden rounded-[12px] shadow-[inset_0_0_0_1px_var(--color-line)]">
            <table className="w-full text-left text-[12px]">
              <thead className="bg-wash text-[11px] text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Row</th>
                  <th className="px-3 py-2 font-medium">LRN</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Sex</th>
                  <th className="px-3 py-2 font-medium">Birth date</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const st = statusOf(r)
                  const l = r.learner
                  return (
                    <tr key={r.line} className={cx('border-t border-line-soft', st !== 'ready' && 'bg-[#fcfcfd]')}>
                      <td className="tnum px-3 py-2 text-muted">{r.line}</td>
                      <td className="px-3 py-2 font-mono text-[11.5px] text-navy-900">{l.lrn || '—'}</td>
                      <td className="px-3 py-2 font-medium text-navy-900">
                        {[l.lastName, [l.firstName, l.middleName, l.nameExt].filter(Boolean).join(' ')]
                          .filter(Boolean)
                          .join(', ') || '—'}
                      </td>
                      <td className="px-3 py-2 text-navy-900">{l.sex || '—'}</td>
                      <td className="tnum px-3 py-2 whitespace-nowrap text-navy-900">
                        {l.birthDate ? formatDate(l.birthDate) : '—'}
                      </td>
                      <td className="px-3 py-2">
                        {st === 'ready' && <span className="font-semibold text-[var(--color-n)]">Ready</span>}
                        {st === 'registered' && <span className="text-muted">Already registered</span>}
                        {st === 'problem' && <span className="font-medium text-[#9f1239]">{r.problem}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <footer className="shrink-0 border-t border-line-soft bg-canvas px-7 py-4">
        {failure && (
          <p
            role="alert"
            className="mb-3 flex items-center gap-2 rounded-[10px] bg-[#fdf2f5] px-3.5 py-2.5 text-[12px] font-medium text-[#9f1239]"
          >
            <Warning size={15} weight="fill" className="shrink-0" />
            {failure}
          </p>
        )}
        {rows && !failure && (
          <p className="mb-3 flex items-center gap-2 text-[11.5px] text-muted">
            <Info size={14} weight="fill" className="shrink-0 text-navy-700" />
            Only rows marked Ready are added. Immunization is added later from each learner's profile.
          </p>
        )}
        <div className="flex items-center gap-2.5">
          <Button variant="ghost" className="h-10 px-4 text-[13px]" onClick={onDone} disabled={busy}>
            Cancel
          </Button>
          <span className="flex-1" />
          <Button
            variant="primary"
            className="h-10 rounded-[10px] px-5 text-[13px] font-semibold"
            onClick={() => void save()}
            disabled={busy || !options || !sectionId || counts.ready === 0}
          >
            {busy
              ? 'Importing…'
              : counts.ready > 0
                ? `Import ${counts.ready} ${counts.ready === 1 ? 'learner' : 'learners'}`
                : 'Import'}
          </Button>
        </div>
      </footer>
    </ModalContent>
  )
}
