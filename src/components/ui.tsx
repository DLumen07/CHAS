import { forwardRef, useState } from 'react'
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes } from 'react'
import { Eye, EyeSlash } from '@phosphor-icons/react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { BAND_COLOR } from '@/lib/nutrition'

/* Join classes, and let the LAST one win.

   This used to be a plain filter-and-join, which is wrong the moment a caller
   tries to override a default: "px-3" and "px-5" both survive into the class
   attribute, and which one applies is then decided by the order Tailwind
   happened to emit them in, not by the order they were written. That is a bug
   that only shows up on some values.

   tailwind-merge understands the conflict groups and drops the loser, so a
   component's own class always beats the default it was given. clsx handles
   the conditionals. */
export function cx(...parts: ClassValue[]) {
  return twMerge(clsx(parts))
}

/* --- Pill tabs ------------------------------------------------------------
   Every tab and toggle in the app is a row of fully rounded pills: the chosen
   one navy with white text, the rest on the wash, a count beside the label at
   70% (2026-10-13, the user's request, after the dashboard's Priority cases
   filters). Size is left to each use, so a toolbar tab and a card filter
   can share the look at their own heights. */

export const PILL =
  'inline-flex items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-colors duration-100'
export const PILL_ON = 'bg-navy-800 text-white'
export const PILL_OFF = 'bg-wash text-muted hover:bg-navy-50 hover:text-navy-900'

/* --- Surfaces ----------------------------------------------------------- */

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClass,
}: {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClass?: string
}) {
  return (
    <section className={cx('panel flex min-h-0 flex-col', className)}>
      {(title || actions) && (
        <header className="flex shrink-0 items-center justify-between gap-4 px-5 pt-4 pb-3">
          <div className="min-w-0">
            {title && (
              <h2 className="truncate text-[14px] font-semibold tracking-[-0.01em] text-navy-900">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="mt-1 truncate text-[11.5px] leading-snug text-muted">{subtitle}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx('min-h-0 flex-1', bodyClass ?? 'px-5 pb-5')}>{children}</div>
    </section>
  )
}

/* --- Buttons ------------------------------------------------------------ */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-navy-900 text-white hover:bg-navy-800 active:bg-navy-950',
  secondary:
    'bg-white text-navy-900 shadow-[inset_0_0_0_1px_rgba(10,33,67,0.14)] ' +
    'hover:bg-navy-50 active:bg-navy-100',
  ghost: 'text-navy-800 hover:bg-navy-50 active:bg-navy-100',
  danger:
    'bg-white text-[#9f1239] shadow-[inset_0_0_0_1px_rgba(159,18,57,0.24)] ' +
    'hover:bg-[#fdf2f5] active:bg-[#fbe6ec]',
}

/* Shared by both buttons, so the two can never drift apart on the things a
   reader feels rather than sees: the height they occupy in a toolbar, the
   ring they show a keyboard, and what happens under a press.

   THE PRESS. `active:translate-y-px` is the whole of it - one pixel, for as
   long as the mouse is down. It is not decoration: a control that changes
   only its fill on press reads as a picture of a button, and the difference
   between an app that feels responsive and one that feels flat is almost
   entirely in whether its controls acknowledge the moment of contact. One
   pixel is enough to feel and too small to notice, which is the point.

   THE HEIGHT. Pinned rather than left to padding plus line-height. These sit
   in rows beside each other and beside 36px selects, and a toolbar whose
   buttons are 34, 35 and 36 tall is the kind of thing nobody reports and
   everybody sees. */
const BUTTON_BASE = cx(
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap',
  'transition-[background-color,box-shadow,transform] duration-100 ease-out',
  'focus-ring active:translate-y-px',
  'disabled:pointer-events-none disabled:translate-y-0',
)

/* forwardRef, and not for the usual reason.
 *
 * Nothing in this app calls a button imperatively. What needs the ref is
 * Radix: `<PopoverTrigger asChild><Button/></PopoverTrigger>` clones this
 * component and hands it a ref so the panel can be positioned against it and
 * focus can be returned to it on close. A plain function component drops that
 * ref, React warns, and the trigger loses its anchor - which is a popover
 * that opens in the wrong place, silently, on the one screen that uses it. */
export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: ReactNode }
>(function Button({ variant = 'secondary', icon, children, className, ...rest }, ref) {
  return (
    <button
      {...rest}
      ref={ref}
      className={cx(
        BUTTON_BASE,
        'h-9 rounded-[10px] px-3.5 text-[12.5px] font-medium',
        'disabled:opacity-40',
        VARIANTS[variant],
        className,
      )}
    >
      {icon}
      {children}
    </button>
  )
})

/* --- Accent: the ONE gold element per screen ---------------------------- */

export function AccentButton({
  icon,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode }) {
  return (
    <button
      {...rest}
      className={cx(
        BUTTON_BASE,
        'h-9 gap-2 rounded-[10px] px-4 text-[12.5px] font-semibold',
        // The school seal's yellow behind navy-950 text: 13.3:1, and the
        // brand's own colour pairing. One of these per screen.
        'bg-seal-yellow text-navy-950',
        'hover:bg-seal-yellow-hover active:bg-seal-yellow-active',
        /* A gold button is the one place on a white card where the fill is
           strong enough to carry its own edge, so it gets a soft drop the
           secondary buttons do not. It is what makes the single accent on a
           screen read as raised rather than as a coloured rectangle. */
        'shadow-[0_1px_2px_rgba(120,90,0,0.18),0_6px_14px_-8px_rgba(120,90,0,0.5)]',
        'disabled:bg-line disabled:text-muted disabled:shadow-none',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  )
}

/* --- Form controls ------------------------------------------------------ */

/* forwardRef so a screen can put focus in the box - the sign-in form sends
   focus to the first field that failed validation. React 18 does not pass
   `ref` through as an ordinary prop. */
export const Field = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & {
  label: string
  hint?: string
  suffix?: string
  /** A glyph inside the LEFT edge of the box, naming what the field is for.
      Decorative and not focusable: the visible label above already names the
      field, so an icon that could be tabbed to would be a second stop on the
      way to the same input. Sized by the caller. */
  leading?: ReactNode
  /** An interactive control sitting inside the right edge of the box - a
      reveal toggle, a unit picker. Unlike `suffix` it can be clicked, so it
      is not wrapped in the pointer-events-none span. */
  trailing?: ReactNode
  /** Message shown under the box, in place of the hint. It also recolours the
      box and sets `aria-invalid`, so the error is never carried by the red
      text alone. */
  error?: string
  /** Class for the <input> itself. `className` styles the wrapping label, so
      a caller wanting a taller box had no way to say so without also moving
      the label and the hint. */
  inputClassName?: string
}
>(function Field(
  { label, hint, suffix, leading, trailing, error, className, inputClassName, ...rest },
  ref,
) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-[11.5px] font-medium text-muted">{label}</span>
      <span className="relative block">
        {leading && (
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-placeholder">
            {leading}
          </span>
        )}
        <input
          {...rest}
          ref={ref}
          aria-invalid={error ? true : undefined}
          className={cx(
            'tnum w-full rounded-[10px] border bg-white px-3 py-2',
            'text-[13px] text-ink placeholder:text-[#68768e]',
            'transition-[border-color,box-shadow] duration-100',
            'focus:outline-none',
            error
              ? 'border-[#c4708a] focus:border-[#9f1239] focus:shadow-[0_0_0_3px_rgba(159,18,57,0.14)]'
              : 'border-line hover:border-[#c2cddd] focus:border-navy-600 focus:shadow-[0_0_0_3px_rgba(29,82,153,0.14)]',
            Boolean(leading) && 'pl-10',
            Boolean(suffix || trailing) && 'pr-9',
            inputClassName,
          )}
        />
        {suffix && (
          <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[11px] text-muted">
            {suffix}
          </span>
        )}
        {trailing && <span className="absolute top-1/2 right-1.5 -translate-y-1/2">{trailing}</span>}
      </span>
      {error ? (
        <span className="mt-1 block text-[11px] font-medium text-[#9f1239]">{error}</span>
      ) : (
        hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>
      )}
    </label>
  )
})

/* A password box with a Show / Hide button inside its right edge. Every
   form that sets a password uses it for both the new password and its
   confirmation (2026-10-22, the user's request), each with its own toggle so
   one can be checked against the other. Hidden to start: the head's forms
   used to show the first password in plain text, and a screen at the clinic
   desk is often in view of others. */
export const PasswordField = forwardRef<
  HTMLInputElement,
  Omit<Parameters<typeof Field>[0], 'type' | 'trailing' | 'ref'>
>(function PasswordField({ inputClassName, ...rest }, ref) {
  const [shown, setShown] = useState(false)
  return (
    <Field
      {...rest}
      ref={ref}
      type={shown ? 'text' : 'password'}
      spellCheck={false}
      inputClassName={cx(inputClassName, 'pr-11')}
      trailing={
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-pressed={shown}
          className="mr-0.5 grid size-8 place-items-center rounded-full text-muted transition-colors duration-100 hover:bg-navy-50 hover:text-navy-800"
        >
          {shown ? <EyeSlash size={16} /> : <Eye size={16} />}
        </button>
      }
    />
  )
})

/* --- Status encoding ---------------------------------------------------- */

export function BandChip({ band, dense }: { band: string | null; dense?: boolean }) {
  if (!band) {
    return (
      <span className="inline-flex items-center rounded-full bg-wash px-2 py-0.5 text-[11px] whitespace-nowrap text-muted">
        Not measured
      </span>
    )
  }
  const color = BAND_COLOR[band as keyof typeof BAND_COLOR]
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-1.5',
        'text-[11px] font-medium whitespace-nowrap',
        dense && 'pr-2 pl-1',
      )}
      style={{
        color,
        background: `color-mix(in srgb, ${color} 9%, white)`,
        /* A hairline of the band's own colour at low alpha. The 9% wash alone
           is so close to white that on a white card the chip had no edge -
           the word floated, and a reader scanning a column of them could not
           see where one finding stopped and the next began. The ring is what
           makes it read as a marked value rather than as coloured text. */
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 22%, transparent)`,
      }}
    >
      {/* The dot is the clinical half of this chip. It repeats the band's
          colour at full strength where the text carries it at reading weight,
          and it is what lets a column of these be scanned down for a single
          band without reading a word of it. */}
      <span
        aria-hidden
        className="size-[7px] shrink-0 rounded-full"
        style={{ background: color }}
      />
      {band}
    </span>
  )
}

/* --- Tone -------------------------------------------------------------- */

/* The six tints a summary tile or a panel heading is allowed to take.

   Lifted out of Dashboard when the admin screen wanted the same set. Two
   copies of a colour map is how two screens in one app end up with panel
   headings a shade apart, and the shade is never noticed until both are on a
   projector next to each other.

   These are decorative only, and stay inside the navy/blue/gold brand family
   plus the two status hues borrowed at low saturation for icon plates. The
   clinical scale itself belongs to BandChip and the charts. */
const CHIP_TONE = {
  navy: 'bg-navy-50 text-navy-700',
  blue: 'bg-[#e7effb] text-[#1d4ed8]',
  green: 'bg-[#e6f4ec] text-[var(--color-n)]',
  violet: 'bg-[#efe9fd] text-[var(--color-ow)]',
  gold: 'bg-gold-100 text-gold-700',
  red: 'bg-[#fbe6ec] text-[var(--color-sw)]',
} as const

export type Tone = keyof typeof CHIP_TONE

/** The tinted square a panel heading or a tile puts its glyph in. */
export function IconChip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={cx('grid size-6 shrink-0 place-items-center rounded-[7px]', CHIP_TONE[tone])}>
      {children}
    </span>
  )
}

/** The wash a tile takes behind that glyph. Paler than the chip by design:
    the chip is a mark and the tile is a ground, and at tile size the chip's
    own tint reads as a coloured card. */
export const TILE_TONE: Record<Tone, string> = {
  navy: 'bg-[#f3f6fd]',
  blue: 'bg-[#f2f7fe]',
  green: 'bg-[#f0f9f4]',
  violet: 'bg-[#f6f3fe]',
  gold: 'bg-[#fdf8ec]',
  red: 'bg-[#fdf3f6]',
}

/** A panel with nothing in it yet. One sentence, centred, no illustration -
    a panel that is empty because the work has not been done says so in the
    space the work will occupy. */
export function Blank({ children }: { children: ReactNode }) {
  return (
    <p className="my-auto px-1 py-6 text-center text-[12px] leading-relaxed text-muted">
      {children}
    </p>
  )
}

export function Empty({ icon, title, body }: { icon?: ReactNode; title: string; body?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 py-12 text-center">
      {icon && <div className="text-[#b6c1d2]">{icon}</div>}
      <div className="text-[13px] font-medium text-navy-900">{title}</div>
      {body && <p className="max-w-[42ch] text-[12px] leading-relaxed text-muted">{body}</p>}
    </div>
  )
}
