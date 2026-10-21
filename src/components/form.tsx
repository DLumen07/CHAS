import type { ReactNode } from 'react'
import { cx } from './ui'
import type { ConditionStatus, DoseStatus, EnrolmentStatus } from '../lib/api'

/* The controls CHAS forms are built from, and the words its enums are read
   back in.

   These began inside the registration dialog. The learner's record then had to
   edit the same five sections, and a second set of text boxes styled by hand
   is how one form ends up with a 10px label and its neighbour an 11px one -
   or worse, how a form that writes "Transferred in" comes to face a record
   that reads back "TRANSFERRED_IN". One module, both dialogs.

   NOT the app's `Field` from ui.tsx, and not its `Select` primitive. `Field`
   takes a plain string label and these need a required marker inside it;
   `Select` is a toolbar pill, which is the right shape above a table and the
   wrong one beside a text box it has to share a border, a height and a focus
   ring with.
-------------------------------------------------------------------------- */

export const ENROLMENT_STATUSES: { value: EnrolmentStatus; label: string }[] = [
  { value: 'ENROLLED', label: 'Enrolled' },
  { value: 'TRANSFERRED_IN', label: 'Transferred in' },
  { value: 'RETURNING', label: 'Returning' },
  { value: 'TRANSFERRED_OUT', label: 'Transferred out' },
  { value: 'DROPPED', label: 'Dropped' },
]

export const CONDITION_STATUSES: { value: ConditionStatus; label: string }[] = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'RECURRING', label: 'Recurring' },
  { value: 'UNKNOWN', label: 'Unknown' },
]

export const DOSE_STATUSES: { value: DoseStatus; label: string }[] = [
  { value: 'GIVEN', label: 'Given' },
  { value: 'SCHEDULED', label: 'Scheduled' },
  { value: 'MISSED', label: 'Missed' },
  { value: 'UNKNOWN', label: 'Unknown' },
]

/* The vaccines on a Philippine child immunization card, in the order the card
   prints them. A datalist rather than a closed select: a card may carry
   something not on this list, and a picker that cannot spell what is written
   on the card is worse than a text box. */
export const COMMON_VACCINES = [
  'BCG',
  'Hepatitis B',
  'Pentavalent (DPT-HepB-Hib)',
  'Oral Polio (OPV)',
  'Inactivated Polio (IPV)',
  'Pneumococcal (PCV)',
  'Measles, Mumps, Rubella (MMR)',
  'Measles-Rubella (MR)',
  'Tetanus-diphtheria (Td)',
  'Human Papillomavirus (HPV)',
  'Influenza',
  'COVID-19',
]

/** The enum labels, so a form and the record that reads it back cannot drift
    into two sets of words for one value. */
export const LABELS = {
  condition: Object.fromEntries(CONDITION_STATUSES.map((c) => [c.value, c.label])) as Record<
    ConditionStatus,
    string
  >,
  dose: Object.fromEntries(DOSE_STATUSES.map((d) => [d.value, d.label])) as Record<
    DoseStatus,
    string
  >,
  enrolment: Object.fromEntries(ENROLMENT_STATUSES.map((e) => [e.value, e.label])) as Record<
    EnrolmentStatus,
    string
  >,
}

/** The red asterisk, one instance, so every form marks required the same way. */
export const REQ = <span className="ml-0.5 font-semibold text-[#9f1239]">*</span>

/* --- The controls --------------------------------------------------------- */

export const INPUT_BASE = cx(
  'w-full rounded-[10px] border bg-white px-3',
  'text-[13px] text-ink placeholder:text-placeholder',
  'transition-[border-color,box-shadow] duration-100',
  'focus:outline-none disabled:bg-wash disabled:text-muted',
)

/* The caret, drawn in the palette. `appearance-none` removes the platform one,
   and an OS caret is the single control on a screen that cannot be made to
   match the rest of it. It lives in a style attribute rather than an arbitrary
   Tailwind value: a data: URI carrying quotes and parentheses does not survive
   that parser - the class lands in the markup and no rule is generated, which
   is a select with no caret at all. */
export const CARET =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'>" +
  "<path d='M1 1l5 5 5-5' fill='none' stroke='%235a6b85' stroke-width='2' " +
  "stroke-linecap='round' stroke-linejoin='round'/></svg>\")"

export function inputTone(invalid?: boolean) {
  return invalid
    ? 'border-[#c4708a] focus:border-[#9f1239] focus:shadow-[0_0_0_3px_rgba(159,18,57,0.14)]'
    : 'border-line hover:border-[#c2cddd] focus:border-navy-600 focus:shadow-[0_0_0_3px_rgba(43,82,196,0.14)]'
}

/** The label, hint and error scaffolding every control here shares. */
export function Fieldset({
  label,
  hint,
  error,
  dense,
  children,
}: {
  label: ReactNode
  hint?: string
  error?: string
  dense?: boolean
  children: ReactNode
}) {
  return (
    <div className="block">
      <span
        className={cx(
          'mb-1 block font-medium text-navy-900',
          dense ? 'text-[10.5px]' : 'text-[11.5px]',
        )}
      >
        {label}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-[11px] font-medium text-[#9f1239]">{error}</span>
      ) : (
        hint && <span className="mt-1 block text-[10.5px] leading-snug text-muted">{hint}</span>
      )}
    </div>
  )
}

export function TextInput({
  label,
  hint,
  error,
  value,
  onChange,
  className,
  dense,
  span,
  ...rest
}: {
  label: ReactNode
  hint?: string
  error?: string
  value: string
  onChange: (v: string) => void
  className?: string
  dense?: boolean
  /** Columns to occupy in a FormRow. */
  span?: 1 | 2
  type?: string
  placeholder?: string
  inputMode?: 'numeric' | 'tel' | 'text'
  max?: string
  list?: string
  disabled?: boolean
}) {
  return (
    <div className={cx(span === 2 && 'md:col-span-2')}>
      <Fieldset label={label} hint={hint} error={error} dense={dense}>
        <input
          {...rest}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          className={cx(
            INPUT_BASE,
            inputTone(Boolean(error)),
            dense ? 'py-1.5' : 'py-2.5',
            className,
          )}
        />
      </Fieldset>
    </div>
  )
}

export function TextArea({
  label,
  hint,
  value,
  onChange,
  rows = 3,
}: {
  label: ReactNode
  hint?: string
  value: string
  onChange: (v: string) => void
  rows?: number
}) {
  return (
    <Fieldset label={label} hint={hint}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className={cx(INPUT_BASE, inputTone(false), 'resize-y py-2.5 leading-relaxed')}
      />
    </Fieldset>
  )
}

export function NativeSelect({
  value,
  onChange,
  children,
  disabled,
  invalid,
  dense,
}: {
  value: string
  onChange: (v: string) => void
  children: ReactNode
  disabled?: boolean
  invalid?: boolean
  dense?: boolean
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-invalid={invalid ? true : undefined}
      style={{ backgroundImage: CARET }}
      className={cx(
        INPUT_BASE,
        inputTone(invalid),
        dense ? 'py-1.5' : 'py-2.5',
        'appearance-none bg-[length:10px_7px] bg-[right_0.8rem_center] bg-no-repeat pr-9',
      )}
    >
      {children}
    </select>
  )
}

/** A value a form shows rather than asks for: a computed age, or a field this
    account is not allowed to change. */
export function Readout({
  label,
  hint,
  lock,
  children,
}: {
  label: string
  hint?: string
  lock?: ReactNode
  children: ReactNode
}) {
  return (
    <Fieldset
      label={
        <span className="flex items-center gap-1.5">
          {label}
          {lock}
        </span>
      }
      hint={hint}
    >
      <div className="flex min-h-[42px] items-center rounded-[10px] bg-wash px-3 py-2.5">
        {children}
      </div>
    </Fieldset>
  )
}

/** A pressed-state option. Used where the choice is short enough to show all
    of it, which reads faster than a menu that must be opened to be read. */
export function Choice({
  pressed,
  onClick,
  children,
  sub,
  stacked,
}: {
  pressed: boolean
  onClick: () => void
  children: ReactNode
  sub?: string
  stacked?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={cx(
        'rounded-[10px] px-3 py-2.5 text-[12.5px] font-medium',
        'transition-[box-shadow,background,color] duration-100',
        stacked ? 'text-left' : 'flex items-center justify-center gap-2',
        pressed
          ? 'bg-navy-50 text-navy-900 shadow-[inset_0_0_0_2px_var(--color-navy-600)]'
          : 'text-muted shadow-[inset_0_0_0_1px_var(--color-line)] hover:shadow-[inset_0_0_0_1px_#c2cddd]',
      )}
    >
      <span className={stacked ? 'block' : 'contents'}>{children}</span>
      {sub && (
        <span
          className={cx(
            'mt-0.5 block text-[10px] leading-snug',
            pressed ? 'text-navy-700' : 'text-placeholder',
          )}
        >
          {sub}
        </span>
      )}
    </button>
  )
}

/** Two fields across on a wide dialog, stacked on a narrow one. */
export function FormRow({ children }: { children: ReactNode }) {
  return <div className="grid gap-3.5 md:grid-cols-2">{children}</div>
}

/* --- Status chips --------------------------------------------------------- */

const DOSE_TONE: Record<DoseStatus, string> = {
  GIVEN: 'bg-[#e6f4ec] text-[var(--color-n)]',
  SCHEDULED: 'bg-navy-50 text-navy-800',
  MISSED: 'bg-[#fbe6ec] text-[var(--color-sw)]',
  UNKNOWN: 'bg-wash text-muted',
}

export function DoseChip({ status }: { status: DoseStatus }) {
  return (
    <span
      className={cx(
        'shrink-0 rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold whitespace-nowrap',
        DOSE_TONE[status],
      )}
    >
      {LABELS.dose[status]}
    </span>
  )
}

/* The four condition values are not a scale, so they do not take the clinical
   palette: ACTIVE and RECURRING are things to act on today and carry warmth,
   RESOLVED is settled, UNKNOWN is honestly grey. */
const CONDITION_TONE: Record<ConditionStatus, string> = {
  ACTIVE: 'bg-[#fbe6ec] text-[var(--color-sw)]',
  RECURRING: 'bg-gold-100 text-gold-700',
  RESOLVED: 'bg-[#e6f4ec] text-[var(--color-n)]',
  UNKNOWN: 'bg-wash text-muted',
}

export function ConditionChip({ status }: { status: ConditionStatus }) {
  return (
    <span
      className={cx(
        'rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold whitespace-nowrap',
        CONDITION_TONE[status],
      )}
    >
      {LABELS.condition[status]}
    </span>
  )
}
