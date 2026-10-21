import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { CaretDown, CaretUp, PencilSimple, Plus, Trash, Warning } from '@phosphor-icons/react'
import { Button, cx } from '@/components/ui'
import { Fieldset, NativeSelect, TextInput } from '@/components/form'
import { ConfirmDialog, Modal, ModalCloseButton, ModalContent, ModalDescription, ModalTitle } from '@/components/primitives'
import { toast } from '@/components/toast'
import { ApiError, endpoints, type ApiGradeLevel, type SectionBody } from '@/lib/api'
import { refresh } from '@/lib/server-records'

/* Year levels and sections, in School settings. Head only.

   Added 2026-10-17: the user asked for the head to set these up in full
   rather than live with the six grades created at first launch. One list,
   the year levels in order, each with its sections under it. Every change
   is saved as it is made; there is no Save button for this part.

   The order of the list is the order of the grades: a rollover promotes
   each learner to the next year level down the list, so the up and down
   arrows are how the head says which year follows which. The server keeps
   the levels numbered 1 to n.

   Removing is offered only where nothing is lost: a year level with no
   sections, a section no learner record has ever pointed at. Everywhere
   else the control is there but switched off, and its label says why. */

type Grade = ApiGradeLevel
type Section = ApiGradeLevel['sections'][number]

type Editing =
  | { kind: 'grade'; grade: Grade | null }
  | { kind: 'section'; section: Section | null; gradeId: string }
  | null

type Removing = { kind: 'grade'; grade: Grade } | { kind: 'section'; section: Section } | null

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

export function ClassesSettings() {
  const [grades, setGrades] = useState<Grade[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing>(null)
  const [removing, setRemoving] = useState<Removing>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    endpoints
      .classes()
      .then((r) => setGrades(r.grades))
      .catch((err) => setLoadError(message(err, 'Unable to load the year levels.')))
  }, [])

  /* Every change answers with the whole layout. The roster is refreshed
     too, so the Learners screen and the pickers show the new names. */
  function applied(next: Grade[], done: string) {
    setGrades(next)
    toast.success(done)
    void refresh()
  }

  async function move(g: Grade, direction: 'up' | 'down') {
    setBusy(true)
    try {
      const r = await endpoints.moveGrade(g.id, direction)
      setGrades(r.grades)
      void refresh()
    } catch (err) {
      toast.error(message(err, 'Unable to move the year level.'))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const r = removing
    if (!r) return
    setBusy(true)
    try {
      if (r.kind === 'grade') {
        applied((await endpoints.deleteGrade(r.grade.id)).grades, `${r.grade.name} removed.`)
      } else {
        applied((await endpoints.deleteSection(r.section.id)).grades, `${r.section.name} removed.`)
      }
      setRemoving(null)
    } catch (err) {
      setRemoving(null)
      toast.error(message(err, 'Unable to remove it.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold text-navy-900">Year levels and sections</h3>
          <p className="mt-1 max-w-[460px] text-[12px] text-muted">
            The classes learners are enrolled in. List the year levels in order; learners are promoted to
            the next year level in the list.
          </p>
        </div>
        <Button
          className="h-9 px-4 text-[12.5px]"
          icon={<Plus size={14} weight="bold" />}
          onClick={() => setEditing({ kind: 'grade', grade: null })}
          disabled={grades === null}
        >
          Add year level
        </Button>
      </div>

      {loadError && <Alert>{loadError}</Alert>}

      {grades && grades.length === 0 && (
        <p className="mt-5 rounded-[12px] bg-wash px-4 py-6 text-center text-[12.5px] text-muted">
          No year levels yet. Add the first year level, then its sections.
        </p>
      )}

      {grades && grades.length > 0 && (
        <ol className="mt-5 space-y-3">
          {grades.map((g, i) => (
            <li key={g.id} className="rounded-[14px] border border-line-soft">
              <div className="flex items-center gap-3 px-4 py-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-navy-50 text-[11px] font-bold text-navy-700">
                  {g.level}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-navy-900">{g.name}</div>
                  <div className="text-[11px] text-muted">
                    {g.sections.length === 1 ? '1 section' : `${g.sections.length} sections`}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <IconAction label="Move up" disabled={busy || i === 0} onClick={() => void move(g, 'up')}>
                    <CaretUp size={14} weight="bold" />
                  </IconAction>
                  <IconAction
                    label="Move down"
                    disabled={busy || i === grades.length - 1}
                    onClick={() => void move(g, 'down')}
                  >
                    <CaretDown size={14} weight="bold" />
                  </IconAction>
                  <IconAction label="Rename" disabled={busy} onClick={() => setEditing({ kind: 'grade', grade: g })}>
                    <PencilSimple size={14} weight="bold" />
                  </IconAction>
                  <IconAction
                    label={g.sections.length ? 'Remove its sections first' : 'Remove'}
                    danger
                    disabled={busy || g.sections.length > 0}
                    onClick={() => setRemoving({ kind: 'grade', grade: g })}
                  >
                    <Trash size={14} weight="bold" />
                  </IconAction>
                </div>
              </div>

              <ul className="divide-y divide-line-soft border-t border-line-soft">
                {g.sections.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 py-2.5 pr-4 pl-14">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] font-medium text-navy-900">{s.name}</div>
                      <div className="truncate text-[11px] text-muted">
                        {s.adviser || 'No adviser'} · {s.learners === 1 ? '1 learner' : `${s.learners} learners`}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <IconAction
                        label="Edit"
                        disabled={busy}
                        onClick={() => setEditing({ kind: 'section', section: s, gradeId: g.id })}
                      >
                        <PencilSimple size={14} weight="bold" />
                      </IconAction>
                      <IconAction
                        label={s.removable ? 'Remove' : 'Has learner records; cannot be removed'}
                        danger
                        disabled={busy || !s.removable}
                        onClick={() => setRemoving({ kind: 'section', section: s })}
                      >
                        <Trash size={14} weight="bold" />
                      </IconAction>
                    </div>
                  </li>
                ))}
                <li className="py-2 pr-4 pl-12">
                  <button
                    type="button"
                    onClick={() => setEditing({ kind: 'section', section: null, gradeId: g.id })}
                    disabled={busy}
                    className="inline-flex h-8 items-center gap-1.5 rounded-[9px] px-2 text-[12px] font-medium text-navy-700 transition-colors duration-100 hover:bg-wash disabled:opacity-40"
                  >
                    <Plus size={13} weight="bold" />
                    Add section
                  </button>
                </li>
              </ul>
            </li>
          ))}
        </ol>
      )}

      {editing?.kind === 'grade' && (
        <GradeModal
          grade={editing.grade}
          onClose={() => setEditing(null)}
          onSaved={(next, done) => {
            setEditing(null)
            applied(next, done)
          }}
        />
      )}
      {editing?.kind === 'section' && grades && (
        <SectionModal
          section={editing.section}
          gradeId={editing.gradeId}
          grades={grades}
          onClose={() => setEditing(null)}
          onSaved={(next, done) => {
            setEditing(null)
            applied(next, done)
          }}
        />
      )}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.kind === 'grade' ? removing.grade.name : (removing?.section.name ?? '')}?`}
        body={
          removing?.kind === 'grade'
            ? 'The year level will be removed from the list. The year levels after it move up one place.'
            : 'The section will be removed from the list. It has no learner records.'
        }
        confirmLabel="Remove"
        tone="danger"
        busy={busy}
        onConfirm={() => void remove()}
      />
    </section>
  )
}

/* --- Modals -------------------------------------------------------------- */

function GradeModal({
  grade,
  onClose,
  onSaved,
}: {
  grade: Grade | null
  onClose: () => void
  onSaved: (grades: Grade[], done: string) => void
}) {
  const [name, setName] = useState(grade?.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    const value = name.trim()
    if (!value) {
      setError('Enter the year level name.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const r = grade ? await endpoints.renameGrade(grade.id, value) : await endpoints.addGrade(value)
      onSaved(r.grades, grade ? 'Year level renamed.' : `${value} added.`)
    } catch (err) {
      setError(message(err, 'Unable to save the year level.'))
      setBusy(false)
    }
  }

  return (
    <FormModal
      title={grade ? 'Rename year level' : 'Add year level'}
      description={
        grade ? 'The new name is shown on every screen and report.' : 'The year level is added to the end of the list.'
      }
      submitLabel={grade ? 'Save' : 'Add year level'}
      error={error}
      busy={busy}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <TextInput label="Name" placeholder="Grade 1" value={name} onChange={setName} />
    </FormModal>
  )
}

function SectionModal({
  section,
  gradeId,
  grades,
  onClose,
  onSaved,
}: {
  section: Section | null
  gradeId: string
  grades: Grade[]
  onClose: () => void
  onSaved: (grades: Grade[], done: string) => void
}) {
  const [form, setForm] = useState<SectionBody>({
    name: section?.name ?? '',
    gradeLevelId: gradeId,
    adviser: section?.adviser ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof SectionBody) => (v: string) => setForm((f) => ({ ...f, [k]: v }))
  const moving = section !== null && form.gradeLevelId !== gradeId && section.learners > 0

  async function submit() {
    const body = { name: form.name.trim(), gradeLevelId: form.gradeLevelId, adviser: form.adviser.trim() }
    if (!body.name) {
      setError('Enter the section name.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const r = section ? await endpoints.updateSection(section.id, body) : await endpoints.addSection(body)
      onSaved(r.grades, section ? 'Section saved.' : `${body.name} added.`)
    } catch (err) {
      setError(message(err, 'Unable to save the section.'))
      setBusy(false)
    }
  }

  return (
    <FormModal
      title={section ? 'Edit section' : 'Add section'}
      description="Section names must be different across the whole school."
      submitLabel={section ? 'Save' : 'Add section'}
      error={error}
      busy={busy}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <TextInput label="Section name" placeholder="Mabini" value={form.name} onChange={set('name')} />
      <Fieldset label="Year level">
        <NativeSelect value={form.gradeLevelId} onChange={set('gradeLevelId')}>
          {grades.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </NativeSelect>
      </Fieldset>
      <TextInput
        label="Adviser"
        hint="As printed on the SF8. Optional."
        placeholder="Mrs. R. Villanueva"
        value={form.adviser}
        onChange={set('adviser')}
      />
      {moving && (
        <p className="text-[11.5px] leading-relaxed text-muted">
          The {section.learners === 1 ? 'learner' : `${section.learners} learners`} in this section will move with it
          to the new year level.
        </p>
      )}
    </FormModal>
  )
}

function FormModal({
  title,
  description,
  submitLabel,
  error,
  busy,
  onClose,
  onSubmit,
  children,
}: {
  title: string
  description: string
  submitLabel: string
  error: string | null
  busy: boolean
  onClose: () => void
  onSubmit: () => void
  children: ReactNode
}) {
  function submit(e: FormEvent) {
    e.preventDefault()
    onSubmit()
  }
  return (
    <Modal open onOpenChange={(o) => !o && onClose()}>
      <ModalContent className="max-w-[460px]">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-col">
          <div className="flex items-start justify-between gap-3 px-6 pt-6">
            <div>
              <ModalTitle className="font-display text-[18px] leading-none font-bold tracking-[-0.02em] text-navy-900">
                {title}
              </ModalTitle>
              <ModalDescription className="mt-2 text-[12px] leading-relaxed text-muted">{description}</ModalDescription>
            </div>
            <ModalCloseButton />
          </div>
          <div className="min-h-0 space-y-4 overflow-y-auto px-6 pt-5 pb-1">
            {children}
            {error && <Alert>{error}</Alert>}
          </div>
          <div className="flex justify-end gap-2 px-6 pt-4 pb-6">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-[10px] px-4 text-[12.5px] font-medium text-muted transition-colors duration-100 hover:bg-wash hover:text-navy-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="h-10 rounded-[10px] bg-navy-900 px-5 text-[12.5px] font-semibold text-white transition-colors duration-100 hover:bg-navy-800 disabled:opacity-40"
            >
              {busy ? 'Saving…' : submitLabel}
            </button>
          </div>
        </form>
      </ModalContent>
    </Modal>
  )
}

function Alert({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="mt-4 flex items-start gap-2 rounded-[10px] bg-[#fdf2f5] px-3.5 py-2.5 text-[12px] leading-relaxed font-medium text-[#9f1239]"
    >
      <Warning size={15} weight="fill" className="mt-px shrink-0" />
      {children}
    </p>
  )
}

function IconAction({
  label,
  onClick,
  children,
  danger,
  disabled,
}: {
  label: string
  onClick: () => void
  children: ReactNode
  danger?: boolean
  disabled?: boolean
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
        danger ? 'bg-wash text-[#a4262c] enabled:hover:bg-[#fdf2f5]' : 'bg-wash text-navy-700 enabled:hover:bg-navy-50',
      )}
    >
      {children}
    </button>
  )
}
