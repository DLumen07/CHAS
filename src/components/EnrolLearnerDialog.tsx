import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle,
  FileArrowUp,
  Info,
  Plus,
  Ruler,
  Trash,
  User,
  Warning,
  X,
} from '@phosphor-icons/react'
import { Button, cx } from './ui'
import {
  COMMON_VACCINES,
  CONDITION_STATUSES,
  DOSE_STATUSES,
  DoseChip,
  ENROLMENT_STATUSES,
  Fieldset,
  NativeSelect,
  REQ,
  TextArea,
  TextInput,
} from './form'
import { DiscardPrompt, ModalContent, ModalDescription, ModalTitle } from './primitives'
import { toast } from './toast'
import { TODAY } from '../data/mock'
import { ageInMonths, formatAge } from '../lib/nutrition'
import {
  ApiError,
  endpoints,
  type ApiEnrolmentOptions,
  type ApiVaccineDose,
  type ConditionStatus,
  type DoseStatus,
  type EnrolmentStatus,
  type NewLearnerBody,
} from '../lib/api'
import { refresh } from '../lib/server-records'
import { formatDate } from '../lib/dates'
import { nameError } from '../lib/names'

/* Registering a learner.

   WHAT THIS DIALOG IS. Two records at once, and the header says so because
   the difference matters for years: a PERMANENT PROFILE that is created here
   once and reused every June, and THIS YEAR'S ENROLMENT, which is one row in
   a history that will have six of them by the time the child leaves. Nothing
   typed here is a health measurement. Height, weight, BMI, the nutritional
   band and every screening result are separate transactions with their own
   dates, because a child is weighed many times and registered once - and a
   registration form that quietly took a weight would file that weight under
   the day the paperwork was done rather than the day the child stood on the
   scale.

   WHAT IS REQUIRED. The LRN, the two names, the birth date, sex, the class,
   and at least one row from the immunization card. The health history may be
   left empty and filled in later: a school registers children on what the
   office has that morning.

   NO PARENT OR GUARDIAN. Family contact details were removed on 2026-10-15;
   nothing in the app used them.
-------------------------------------------------------------------------- */


/** `quick`: added by a one-tap vaccine chip - dose 1, given, no date. */
type DoseDraft = ApiVaccineDose & { key: string; quick?: boolean }

const STEPS = ['Learner', 'Class', 'Immunization', 'Health history'] as const

/** Which page each validation error belongs to. */
const STEP_OF: Record<string, number> = {
  lrn: 0,
  firstName: 0,
  lastName: 0,
  middleName: 0,
  nameExt: 0,
  birthDate: 0,
  sex: 0,
  sectionId: 1,
  doses: 2,
  dose: 2,
  condition: 3,
}

type Errors = Partial<Record<string, string>>

export function EnrolLearnerDialog({
  section,
  onDone,
  onView,
  onAssess,
  onImport,
}: {
  /** The class the roster currently has open. The dialog's smart default. */
  section: string
  onDone: () => void
  onView: (learnerId: string) => void
  onAssess: (learnerId: string) => void
  /** Swaps this form for the SF1 import. */
  onImport: () => void
}) {
  /* --- 1. Learner ------------------------------------------------------- */
  const [lrn, setLrn] = useState('')
  const [firstName, setFirstName] = useState('')
  const [middleName, setMiddleName] = useState('')
  const [lastName, setLastName] = useState('')
  const [nameExt, setNameExt] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [sex, setSex] = useState<'M' | 'F' | ''>('')

  /* --- 2. Enrolment ----------------------------------------------------- */
  const [sectionId, setSectionId] = useState('')
  const [enrolmentStatus, setEnrolmentStatus] = useState<EnrolmentStatus>('ENROLLED')

  /* --- 4. Health history ------------------------------------------------ */
  const [condition, setCondition] = useState('')
  const [conditionStatus, setConditionStatus] = useState<ConditionStatus>('UNKNOWN')
  const [treatment, setTreatment] = useState('')
  const [healthNotes, setHealthNotes] = useState('')

  /* --- 3. Immunization -------------------------------------------------- */
  const [doses, setDoses] = useState<DoseDraft[]>([])
  const [draft, setDraft] = useState<DoseDraft | null>(null)

  const [options, setOptions] = useState<ApiEnrolmentOptions | null>(null)
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [done, setDone] = useState<{ id: string; stubId: string; name: string } | null>(null)

  /* What this account may offer, asked for once when the dialog opens. The
     roster payload carries section NAMES because that is what nine screens
     display; the id and the school year are this dialog's
     business alone and are not worth widening a shared shape for. */
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
        if (!cancelled) setFailure('Unable to load the class list. Close this form and open it again.')
      })
    return () => {
      cancelled = true
    }
  }, [section])

  /* Age, computed and never typed. It is the birth date said differently, and
     a second box holding a number somebody worked out in their head is a
     second thing to get wrong. */
  const age = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null
    const months = ageInMonths(birthDate, TODAY)
    if (!Number.isFinite(months) || months < 0) return null
    return { months, label: formatAge(months) }
  }, [birthDate])

  const healthTouched = Boolean(condition.trim() || treatment.trim() || healthNotes.trim())

  /* Anything typed. Closing the form then asks before throwing it away. */
  const dirty = Boolean(
    lrn || firstName.trim() || middleName.trim() || lastName.trim() || nameExt.trim() || birthDate || sex ||
      healthTouched || doses.length || draft,
  )
  const [askDiscard, setAskDiscard] = useState(false)
  function attemptClose() {
    if (dirty && !done) setAskDiscard(true)
    else onDone()
  }
  const guard = (e: Event) => {
    e.preventDefault()
    attemptClose()
  }

  /* --- Steps -------------------------------------------------------------

     One page at a time. Next checks only the page being left, so a learner
     page with a missing birth date stops there, and the later pages never
     show errors for fields nobody has reached yet. */
  const [step, setStep] = useState(0)
  const pane = useRef<HTMLDivElement | null>(null)

  function show(n: number) {
    setStep(n)
    pane.current?.scrollTo({ top: 0 })
  }

  function stepErrors(n: number, e: Errors): Errors {
    return Object.fromEntries(Object.entries(e).filter(([k]) => STEP_OF[k] === n))
  }

  function next() {
    const e = stepErrors(step, validate())
    setErrors(e)
    if (Object.keys(e).length === 0) show(step + 1)
  }

  /* --- Validation ------------------------------------------------------- */

  function validate(): Errors {
    const e: Errors = {}

    if (!/^\d{12}$/.test(lrn)) e.lrn = 'The LRN must be 12 digits.'
    if (!lastName.trim()) e.lastName = 'The surname is required.'
    else if (nameError(lastName, 'surname')) e.lastName = nameError(lastName, 'surname')
    if (!firstName.trim()) e.firstName = 'The first name is required.'
    else if (nameError(firstName, 'first name')) e.firstName = nameError(firstName, 'first name')
    if (nameError(middleName, 'middle name')) e.middleName = nameError(middleName, 'middle name')
    if (nameError(nameExt, 'extension')) e.nameExt = nameError(nameExt, 'extension')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) e.birthDate = 'Enter the date of birth.'
    else if (birthDate > TODAY) e.birthDate = 'That date is in the future.'
    else if (age && age.months > 300) e.birthDate = 'Enter a valid date of birth.'
    if (!sex) e.sex = 'Select the learner’s sex.'

    if (!sectionId) e.sectionId = 'Select a grade level and section.'

    if (!condition.trim() && (treatment.trim() || conditionStatus !== 'UNKNOWN')) {
      e.condition = 'Enter the condition.'
    }

    if (doses.length === 0 && !draftReady()) {
      e.doses = 'Add at least one vaccine record.'
    }

    return e
  }

  /* --- Immunization rows ------------------------------------------------ */

  /** A vaccine row still open in the editor, filled in enough to keep. */
  function draftReady(): boolean {
    return Boolean(draft && draft.vaccine.trim() && draft.dose.trim())
  }

  /** A one-tap chip. On: a dose 1, given, undated. Off again: only the dose
      the chip added - a dose typed in with its date is removed from its own
      row, never by a chip. */
  function toggleQuick(vaccine: string) {
    const quick = doses.find((d) => d.vaccine === vaccine && d.quick)
    if (quick) {
      setDoses((p) => p.filter((d) => d.key !== quick.key))
      return
    }
    if (doses.some((d) => d.vaccine === vaccine)) return
    setDoses((p) => [...p, { key: crypto.randomUUID(), vaccine, dose: '1', status: 'GIVEN', quick: true }])
    setErrors((p) => ({ ...p, doses: undefined }))
  }

  function startDose() {
    setDraft({ key: crypto.randomUUID(), vaccine: '', dose: '1', status: 'GIVEN' })
  }

  function commitDose() {
    if (!draft) return
    if (!draft.vaccine.trim() || !draft.dose.trim()) {
      setErrors((p) => ({ ...p, dose: 'Enter the vaccine and the dose.' }))
      return
    }
    setDoses((p) => [...p, { ...draft, vaccine: draft.vaccine.trim(), dose: draft.dose.trim() }])
    setDraft(null)
    setErrors((p) => ({ ...p, dose: undefined, doses: undefined }))
  }

  /* --- Save ------------------------------------------------------------- */

  async function save() {
    setFailure(null)
    const e = validate()
    if (Object.keys(e).length) {
      /* Back to the earliest page with a problem, showing only its errors. */
      const first = Math.min(...Object.keys(e).map((k) => STEP_OF[k] ?? 0))
      setErrors(stepErrors(first, e))
      show(first)
      return
    }
    setErrors({})

    /* A row typed into the editor but not yet added is still part of the
       card the nurse is copying. */
    const allDoses =
      draft && draftReady()
        ? [...doses, { ...draft, vaccine: draft.vaccine.trim(), dose: draft.dose.trim() }]
        : doses

    const body: NewLearnerBody = {
      lrn,
      lastName: lastName.trim(),
      firstName: firstName.trim(),
      middleName: middleName.trim() || undefined,
      nameExt: nameExt.trim() || undefined,
      sex: sex as 'M' | 'F',
      birthDate,
      sectionId,
      enrolmentStatus,
      healthNotes: healthNotes.trim() || undefined,
      condition: condition.trim()
        ? {
            condition: condition.trim(),
            status: conditionStatus,
            treatment: treatment.trim() || undefined,
          }
        : undefined,
      doses: allDoses.map(({ vaccine, dose, givenOn, status, remarks }) => ({
        vaccine,
        dose,
        givenOn: givenOn || undefined,
        status,
        remarks: remarks || undefined,
      })),
    }

    setBusy(true)
    try {
      const { learner } = await endpoints.enrolLearner(body)
      /* Pull the roster again rather than splicing the new child in by hand.
         The card needs a stub id, a slip state and an immunization row the
         server owns, and a locally assembled stand-in would differ from the
         real one in ways nobody would notice until it printed wrong. */
      await refresh()
      toast.success(`${[firstName.trim(), lastName.trim()].filter(Boolean).join(' ')} was registered.`)
      setDone({
        id: learner.id,
        stubId: learner.stubId,
        name: [firstName.trim(), lastName.trim()].filter(Boolean).join(' '),
      })
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : 'Unable to register the learner.')
    } finally {
      setBusy(false)
    }
  }

  /* --- Registered ------------------------------------------------------- */

  if (done) {
    return (
      <ModalContent className="max-w-[560px]">
        <ModalTitle className="sr-only">Learner successfully registered</ModalTitle>
        <ModalDescription className="sr-only">
          {done.name} has been registered.
        </ModalDescription>

        <div className="px-8 pt-9 pb-8 text-center">
          <div className="mx-auto grid size-14 place-items-center rounded-full bg-[#e6f4ec]">
            <CheckCircle size={30} weight="fill" className="text-[var(--color-n)]" />
          </div>

          <h2 className="mt-4 font-display text-[22px] font-bold tracking-[-0.025em] text-navy-900">
            Learner successfully registered
          </h2>
          <p className="mx-auto mt-2 max-w-[44ch] text-[12.5px] leading-relaxed text-muted">
            <span className="font-semibold text-navy-900">{done.name}</span> is enrolled in {options?.sections.find((s) => s.id === sectionId)?.name ?? section} for{' '}
            {options?.schoolYear}. No measurement has been recorded.
          </p>

          {/* The stub id is the code printed on this child's
              invitation slip, and it is the one thing here that cannot be
              looked up by name later. */}
          <div className="mx-auto mt-5 inline-flex items-center gap-2.5 rounded-full bg-wash px-4 py-2">
            <span className="text-[11px] font-medium text-muted">Invitation stub</span>
            <span className="font-mono text-[13px] font-semibold text-navy-900">{done.stubId}</span>
          </div>

          <div className="mt-7 grid gap-2.5 sm:grid-cols-2">
            <Button
              className="h-11 justify-center rounded-[12px] text-[13px] font-semibold"
              icon={<User size={15} weight="bold" />}
              onClick={() => onView(done.id)}
            >
              View profile
            </Button>
            <Button
              variant="primary"
              className="h-11 justify-center rounded-[12px] text-[13px] font-semibold"
              icon={<Ruler size={15} weight="fill" />}
              onClick={() => onAssess(done.id)}
            >
              Start first assessment
            </Button>
          </div>

          <button
            type="button"
            onClick={onDone}
            className="mt-4 rounded-full px-3 py-1.5 text-[12px] font-medium text-muted transition-colors duration-100 hover:bg-wash hover:text-navy-900"
          >
            Back to learners
          </button>
        </div>
      </ModalContent>
    )
  }

  /* --- The form ---------------------------------------------------------

     A compact window, one page at a time: a progress bar of the four steps,
     the page's fields, and Back / Next. Next turns into "Add learner" on
     the last page, which is optional - a learner can be added there without
     a health history and that filled in later. */

  const last = step === STEPS.length - 1

  return (
    <ModalContent
      /* One height for every step, so the window does not jump as the
         pages change; the longest page scrolls inside it. */
      className="h-[min(92vh,700px)] max-w-[680px]"
      onEscapeKeyDown={guard}
      onPointerDownOutside={guard}
    >
      <DiscardPrompt
        open={askDiscard}
        onKeep={() => setAskDiscard(false)}
        onDiscard={() => {
          setAskDiscard(false)
          onDone()
        }}
      />

      {/* --- Header and progress --------------------------------------- */}
      <header className="shrink-0 px-7 pt-6">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <ModalTitle className="font-display text-[19px] leading-tight font-bold tracking-[-0.02em] text-navy-900">
              Add learner
            </ModalTitle>
            <ModalDescription className="mt-1 text-[12.5px] text-muted">
              Step {step + 1} of {STEPS.length} &middot; {STEPS[step]}
              {last ? ' (optional)' : ''}
            </ModalDescription>
          </div>
          {/* Offered only before anything is typed, so switching never
              throws away a half-filled form. */}
          {step === 0 && !dirty && (
            <button
              type="button"
              onClick={onImport}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] px-3 text-[12.5px] font-medium text-navy-700 shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors duration-100 hover:bg-wash hover:text-navy-900"
            >
              <FileArrowUp size={15} weight="bold" />
              Import from SF1
            </button>
          )}
          <button
            type="button"
            onClick={attemptClose}
            aria-label="Close"
            className="grid size-9 shrink-0 place-items-center rounded-[10px] text-muted transition-colors duration-100 hover:bg-wash hover:text-navy-900"
          >
            <X size={16} weight="bold" />
          </button>
        </div>

        <ol aria-label="Progress" className="mt-5 grid grid-cols-4 gap-2">
          {STEPS.map((label, i) => (
            <li key={label} aria-current={i === step ? 'step' : undefined}>
              <span
                className={cx(
                  'block h-[5px] rounded-full transition-colors duration-200',
                  i <= step ? 'bg-navy-900' : 'bg-line',
                )}
              />
              <span
                className={cx(
                  'mt-2 block truncate text-[11.5px]',
                  i === step
                    ? 'font-semibold text-navy-900'
                    : i < step
                      ? 'font-medium text-navy-700'
                      : 'text-muted',
                )}
              >
                {i + 1}. {label}
              </span>
            </li>
          ))}
        </ol>
      </header>

      {/* --- The page ----------------------------------------------------- */}
      <div ref={pane} className="min-h-0 flex-1 overflow-y-auto px-7 pt-6 pb-7">
        {step === 0 && (
          <div className="space-y-4">
            <TextInput
              label={<>LRN{REQ}</>}
              hint="12 digits, issued by DepEd."
              value={lrn}
              onChange={(v) => setLrn(v.replace(/\D/g, '').slice(0, 12))}
              error={errors.lrn}
              inputMode="numeric"
              placeholder="000000000000"
              className="font-mono text-[14px] tracking-[0.05em]"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput
                label={<>First name{REQ}</>}
                value={firstName}
                onChange={setFirstName}
                error={errors.firstName}
              />
              <TextInput
                label={<>Last name{REQ}</>}
                value={lastName}
                onChange={setLastName}
                error={errors.lastName}
              />
              <TextInput
                label="Middle name"
                value={middleName}
                onChange={setMiddleName}
                error={errors.middleName}
              />
              <TextInput
                label="Extension"
                value={nameExt}
                onChange={(v) => setNameExt(v.slice(0, 16))}
                placeholder="Jr., III"
                error={errors.nameExt}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput
                label={<>Date of birth{REQ}</>}
                type="date"
                max={TODAY}
                value={birthDate}
                onChange={setBirthDate}
                error={errors.birthDate}
              />
              <Fieldset label="Age" hint="Calculated from the date of birth.">
                <div className="flex h-[42px] items-center rounded-[10px] bg-wash px-3">
                  {age ? (
                    <span className="tnum text-[14px] font-semibold text-navy-900">{age.label}</span>
                  ) : (
                    <span className="text-[12.5px] text-placeholder">&mdash;</span>
                  )}
                </div>
              </Fieldset>
            </div>
            <Fieldset label={<>Sex{REQ}</>} error={errors.sex}>
              <div className="grid grid-cols-2 gap-2.5">
                {(['M', 'F'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSex(s)}
                    aria-pressed={sex === s}
                    className={cx(
                      'h-11 rounded-[10px] text-[13px] font-semibold transition-[box-shadow,background,color] duration-100',
                      sex === s
                        ? 'bg-navy-50 text-navy-900 shadow-[inset_0_0_0_2px_var(--color-navy-900)]'
                        : 'text-muted shadow-[inset_0_0_0_1px_var(--color-line)] hover:text-navy-900 hover:shadow-[inset_0_0_0_1px_#c2cddd]',
                    )}
                  >
                    {s === 'M' ? 'Male' : 'Female'}
                  </button>
                ))}
              </div>
            </Fieldset>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <Fieldset label={<>Grade level{REQ}</>} error={errors.sectionId}>
              <div role="radiogroup" aria-label="Grade level" className="grid grid-cols-3 gap-2.5">
                {options?.sections.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={sectionId === s.id}
                    onClick={() => setSectionId(s.id)}
                    className={cx(
                      'h-12 truncate rounded-[10px] px-2 text-[13px] font-semibold transition-[box-shadow,background,color] duration-100',
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
            <div className="grid gap-4 sm:grid-cols-2">
              <Fieldset label="Enrolment status">
                <NativeSelect
                  value={enrolmentStatus}
                  onChange={(v) => setEnrolmentStatus(v as EnrolmentStatus)}
                >
                  {ENROLMENT_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </NativeSelect>
              </Fieldset>
              <Fieldset label="School year">
                <div className="flex h-[42px] items-center rounded-[10px] bg-wash px-3">
                  <span className="tnum text-[13px] font-semibold text-navy-900">
                    {options?.schoolYear ?? '—'}
                  </span>
                </div>
              </Fieldset>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <p className="mb-3 text-[12.5px] text-muted">
              Select each vaccine on the learner&rsquo;s immunization card.{REQ}
            </p>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {QUICK_VACCINES.map((v) => {
                const on = doses.some((d) => d.vaccine === v.vaccine)
                return (
                  <button
                    key={v.vaccine}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleQuick(v.vaccine)}
                    title={v.vaccine}
                    className={cx(
                      'flex h-11 items-center gap-2 rounded-[10px] px-3 text-left text-[13px] font-semibold transition-[box-shadow,background,color] duration-100',
                      on
                        ? 'bg-navy-50 text-navy-900 shadow-[inset_0_0_0_2px_var(--color-navy-900)]'
                        : 'text-muted shadow-[inset_0_0_0_1px_var(--color-line)] hover:text-navy-900 hover:shadow-[inset_0_0_0_1px_#c2cddd]',
                    )}
                  >
                    <span
                      className={cx(
                        'grid size-[18px] shrink-0 place-items-center rounded-[5px]',
                        on ? 'bg-navy-900' : 'shadow-[inset_0_0_0_1.5px_#c2cddd]',
                      )}
                    >
                      {on && <Check size={11} weight="bold" className="text-white" />}
                    </span>
                    <span className="truncate">{v.label}</span>
                  </button>
                )
              })}
            </div>

            {doses.some((d) => !d.quick) && (
              <ul className="mt-4 divide-y divide-line-soft overflow-hidden rounded-[10px] shadow-[inset_0_0_0_1px_var(--color-line)]">
                {doses
                  .filter((d) => !d.quick)
                  .map((d) => (
                    <li key={d.key} className="flex items-center gap-3 bg-white px-3.5 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px] font-medium text-navy-900">
                          {d.vaccine} &middot; dose {d.dose}
                        </div>
                        <div className="truncate text-[11px] text-muted">
                          {d.givenOn ? `Given ${formatDate(d.givenOn)}` : 'No date recorded'}
                          {d.remarks ? ` · ${d.remarks}` : ''}
                        </div>
                      </div>
                      <DoseChip status={d.status} />
                      <button
                        type="button"
                        onClick={() => setDoses((p) => p.filter((x) => x.key !== d.key))}
                        aria-label={`Remove ${d.vaccine} dose ${d.dose}`}
                        className="grid size-7 shrink-0 place-items-center rounded-[8px] text-muted transition-colors duration-100 hover:bg-[#fdf2f5] hover:text-[#9f1239]"
                      >
                        <Trash size={13} weight="bold" />
                      </button>
                    </li>
                  ))}
              </ul>
            )}

            {draft ? (
              <div className="mt-4 rounded-[10px] bg-canvas p-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextInput
                    label="Vaccine"
                    value={draft.vaccine}
                    onChange={(v) => setDraft({ ...draft, vaccine: v })}
                    list="chas-vaccines"
                    placeholder="BCG"
                    dense
                  />
                  <TextInput
                    label="Dose"
                    value={draft.dose}
                    onChange={(v) => setDraft({ ...draft, dose: v })}
                    placeholder="1"
                    dense
                  />
                  <TextInput
                    label="Date given"
                    type="date"
                    max={TODAY}
                    value={draft.givenOn ?? ''}
                    onChange={(v) => setDraft({ ...draft, givenOn: v || undefined })}
                    dense
                  />
                  <Fieldset label="Status" dense>
                    <NativeSelect
                      value={draft.status}
                      onChange={(v) => setDraft({ ...draft, status: v as DoseStatus })}
                      dense
                    >
                      {DOSE_STATUSES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </Fieldset>
                </div>
                <div className="mt-3">
                  <TextInput
                    label="Remarks"
                    value={draft.remarks ?? ''}
                    onChange={(v) => setDraft({ ...draft, remarks: v || undefined })}
                    placeholder="Optional"
                    dense
                  />
                </div>
                <datalist id="chas-vaccines">
                  {COMMON_VACCINES.map((v) => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
                {errors.dose && (
                  <p className="mt-2 text-[11px] font-medium text-[#9f1239]">{errors.dose}</p>
                )}
                <div className="mt-3 flex items-center gap-2">
                  <Button variant="primary" className="h-8" onClick={commitDose}>
                    Add vaccine
                  </Button>
                  <Button className="h-8" onClick={() => setDraft(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={startDose}
                className="mt-4 flex items-center gap-1.5 rounded-[8px] px-1 py-1 text-[12.5px] font-semibold text-navy-700 transition-colors duration-100 hover:text-navy-900"
              >
                <Plus size={13} weight="bold" />
                Add another vaccine or a dose with its date
              </button>
            )}
            {errors.doses && !draft && (
              <p role="alert" className="mt-2 text-[11px] font-medium text-[#9f1239]">
                {errors.doses}
              </p>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <section>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextInput
                  label="Existing condition"
                  hint="For example asthma, epilepsy or an allergy."
                  value={condition}
                  onChange={setCondition}
                  error={errors.condition}
                />
                <Fieldset label="Condition status">
                  <NativeSelect
                    value={conditionStatus}
                    onChange={(v) => setConditionStatus(v as ConditionStatus)}
                  >
                    {CONDITION_STATUSES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </NativeSelect>
                </Fieldset>
                <TextArea
                  label="Treatment or medication"
                  value={treatment}
                  onChange={setTreatment}
                  rows={2}
                />
                <TextArea
                  label="Health notes"
                  value={healthNotes}
                  onChange={setHealthNotes}
                  rows={2}
                />
              </div>
            </section>

            <p className="flex items-start gap-2 text-[11.5px] leading-relaxed text-muted">
              <Info size={14} weight="fill" className="mt-px shrink-0 text-placeholder" />
              This can be left empty and added later from the learner&rsquo;s record. Height and
              weight are recorded on the Weigh-in screen.
            </p>
          </div>
        )}
      </div>

      {/* --- Footer --------------------------------------------------------- */}
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
        <div className="flex items-center gap-2.5">
          <Button
            variant="ghost"
            className="h-10 px-4 text-[13px]"
            onClick={attemptClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <span className="flex-1" />
          {step > 0 && (
            <Button
              className="h-10 px-4 text-[13px]"
              icon={<ArrowLeft size={14} weight="bold" />}
              onClick={() => {
                setErrors({})
                show(step - 1)
              }}
              disabled={busy}
            >
              Back
            </Button>
          )}
          {last ? (
            <Button
              variant="primary"
              className="h-10 rounded-[10px] px-5 text-[13px] font-semibold"
              onClick={() => void save()}
              disabled={busy || !options}
            >
              {busy ? 'Saving…' : 'Add learner'}
            </Button>
          ) : (
            <Button
              variant="primary"
              className="h-10 rounded-[10px] px-5 text-[13px] font-semibold"
              onClick={next}
              disabled={!options}
            >
              Next: {STEPS[step + 1]}
              <ArrowRight size={14} weight="bold" className="ml-1" />
            </Button>
          )}
        </div>
      </footer>
    </ModalContent>
  )
}

/* --- This dialog's own pieces -------------------------------------------- */

/** The vaccines offered as one-tap choices: the infant series every card
    carries. Anything else, or a dose with its date, goes through the full
    row editor. */
const QUICK_VACCINES: { label: string; vaccine: string }[] = [
  { label: 'BCG', vaccine: 'BCG' },
  { label: 'Hepatitis B', vaccine: 'Hepatitis B' },
  { label: 'Pentavalent', vaccine: 'Pentavalent (DPT-HepB-Hib)' },
  { label: 'Oral Polio', vaccine: 'Oral Polio (OPV)' },
  { label: 'PCV', vaccine: 'Pneumococcal (PCV)' },
  { label: 'MMR', vaccine: 'Measles, Mumps, Rubella (MMR)' },
]
