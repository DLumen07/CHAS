import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type MouseEvent, type ReactNode } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import * as SelectPrimitive from '@radix-ui/react-select'
import { CaretDown, Check, X } from '@phosphor-icons/react'
import { cx } from './ui'

/* Behaviour from Radix, appearance from CHAS.

   These are the three controls this app kept writing by hand, and each one
   was missing the part that is genuinely hard:

   - The record dialog handled Escape and returned focus, but never trapped
     it. Tab walked straight out of an open dialog and into the roster behind
     it, which for a keyboard user means the modal is not modal.
   - The filter panel handled outside-clicks and Escape, but its options had
     no roving focus, and nothing told a screen reader that the button owned
     an open panel.
   - The <select> elements were native, so they were correct but rendered as
     an OS menu, which is the one control on a screen that cannot be made to
     match the rest of it.

   The roster dialog, the filter panel and the dashboard's status filter use
   these. The selects on Login, Settings and Slips are still native - they sit
   in forms rather than toolbars and want a different shape, so they are worth
   converting deliberately rather than in passing.

   Focus trapping, scroll locking, `aria-expanded`/`aria-controls` wiring,
   typeahead, arrow-key navigation, collision-aware positioning and the
   return-focus-to-the-trigger rule now come from Radix. What stays here is
   the styling, which is the part that has to match a DepEd form.

   Deliberately NOT shadcn/ui. Its components would have arrived with a
   second token system - --background, --foreground, --primary - alongside
   the clinical palette in index.css, and two sets of tokens in one
   stylesheet is how a design language drifts apart. Radix ships no styles at
   all, which is exactly what was wanted. */

/* --- Modal ---------------------------------------------------------------- */

export const Modal = DialogPrimitive.Root
export const ModalTrigger = DialogPrimitive.Trigger
export const ModalClose = DialogPrimitive.Close
export const ModalTitle = DialogPrimitive.Title
export const ModalDescription = DialogPrimitive.Description

export const ModalContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(function ModalContent({ className, children, ...rest }, ref) {
  return (
    <DialogPrimitive.Portal>
      {/* The wall stays visible behind it, dimmed. A record is a closer look
          at one child in a class, not a different place. */}
      <DialogPrimitive.Overlay
        className="fixed inset-0 z-50 bg-navy-950/45"
      />
      <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-6">
        <DialogPrimitive.Content
          {...rest}
          ref={ref}
          className={cx(
            'pointer-events-auto relative flex max-h-full w-full max-w-[640px] flex-col',
            'overflow-hidden rounded-[20px] bg-white',
            'shadow-[0_24px_60px_-20px_rgba(4,12,36,0.5)]',
            'focus:outline-none',
            className,
          )}
        >
          {children}
        </DialogPrimitive.Content>
      </div>
    </DialogPrimitive.Portal>
  )
})

/** The round close button every dialog in this app puts in its top corner. */
export function ModalCloseButton({
  label = 'Close',
  onClick,
}: {
  label?: string
  /** Call `preventDefault()` on the event to keep the dialog open. */
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <DialogPrimitive.Close
      aria-label={label}
      onClick={onClick}
      className="grid size-8 shrink-0 place-items-center rounded-full bg-wash text-muted transition-colors duration-100 hover:bg-navy-50 hover:text-navy-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-600"
    >
      <X size={14} />
    </DialogPrimitive.Close>
  )
}


/** Asked when a dialog with unsaved typing is about to close: keep editing,
    or throw the changes away. Drawn over the dialog itself. */
export function DiscardPrompt({
  open,
  onKeep,
  onDiscard,
}: {
  open: boolean
  onKeep: () => void
  onDiscard: () => void
}) {
  if (!open) return null
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Discard changes?"
      className="absolute inset-0 z-20 grid place-items-center bg-white/70 backdrop-blur-[1px]"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onKeep()
        }
      }}
    >
      <div className="w-[360px] max-w-[90%] rounded-[16px] bg-white p-5 shadow-[0_18px_50px_-12px_rgba(4,12,36,0.45),0_0_0_1px_rgba(14,36,100,0.08)]">
        <h3 className="text-[15px] font-semibold text-navy-900">Discard your changes?</h3>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
          Unsaved changes will be lost.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onDiscard}
            className="h-9 rounded-[10px] px-3.5 text-[12.5px] font-medium text-[#9f1239] transition-colors duration-100 hover:bg-[#fdf2f5]"
          >
            Discard
          </button>
          <button
            type="button"
            autoFocus
            onClick={onKeep}
            className="h-9 rounded-[10px] bg-navy-900 px-3.5 text-[12.5px] font-semibold text-white transition-colors duration-100 hover:bg-navy-800"
          >
            Keep editing
          </button>
        </div>
      </div>
    </div>
  )
}

/* --- Drawer --------------------------------------------------------------- */

/**
 * A modal panel that comes in from the right edge instead of the middle.
 *
 * Same Radix dialog underneath, and therefore the same focus trap, scroll
 * lock and return-focus behaviour - this is a different SHAPE, not a
 * different guarantee. It is the right shape when the thing being opened is
 * one row of a table the reader wants to stay looking at: a centred dialog
 * covers the list it came from, and a follow-up drawer that hid the queue
 * would make "next one" a matter of closing and re-finding your place.
 *
 * Wide enough for a two-column body at 1366px, and capped so it never becomes
 * the whole screen on a large monitor.
 */
export const DrawerContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(function DrawerContent({ className, children, ...rest }, ref) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-navy-950/45" />
      <DialogPrimitive.Content
        {...rest}
        ref={ref}
        className={cx(
          'fixed top-0 right-0 z-50 flex h-full w-full max-w-[720px] flex-col',
          'bg-canvas shadow-[-24px_0_60px_-24px_rgba(4,12,36,0.45)]',
          'focus:outline-none',
          className,
        )}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
})

/* --- Confirm -------------------------------------------------------------- */

/**
 * The small dialog that stands between a person and something they cannot
 * take back.
 *
 * IT NAMES THE THING. "Are you sure?" without the subject in it is the
 * prompt people learn to click through, so the body is required and the
 * caller is expected to put the learner, the date or the number in it. Sending
 * a message to a parent, closing a follow-up and moving a scheduled date all
 * go through this, because all three are visible outside the building or
 * change a record somebody else is relying on.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel = 'Confirm',
  tone = 'primary',
  busy,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  body: ReactNode
  confirmLabel?: string
  tone?: 'primary' | 'danger'
  busy?: boolean
  onConfirm: () => void
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="max-w-[420px]" aria-describedby={undefined}>
        <div className="px-5 pt-5">
          <ModalTitle className="text-[15px] font-semibold tracking-[-0.01em] text-navy-900">
            {title}
          </ModalTitle>
          <div className="mt-2 text-[12.5px] leading-relaxed text-muted">{body}</div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-9 rounded-[10px] px-3.5 text-[12.5px] font-medium text-muted transition-colors duration-100 hover:bg-wash hover:text-navy-900"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={cx(
              'h-9 rounded-[10px] px-3.5 text-[12.5px] font-semibold text-white',
              'transition-colors duration-100 disabled:opacity-40',
              tone === 'danger'
                ? 'bg-[#a4262c] hover:bg-[#8d1f24]'
                : 'bg-navy-900 hover:bg-navy-800',
            )}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </ModalContent>
    </Modal>
  )
}

/* --- Popover -------------------------------------------------------------- */

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverClose = PopoverPrimitive.Close

export const PopoverContent = forwardRef<
  ElementRef<typeof PopoverPrimitive.Content>,
  ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(function PopoverContent(
  { className, align = 'start', sideOffset = 8, ...rest },
  ref,
) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        {...rest}
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        /* Radix measures the viewport and flips or shifts the panel when it
           would run off the edge. The hand-rolled version was absolutely
           positioned under its trigger and simply went off-screen when the
           trigger sat near the bottom of a short window. */
        collisionPadding={12}
        className={cx(
          'z-40 overflow-auto rounded-[12px] bg-white p-2',
          'max-h-[min(66vh,440px)]',
          'shadow-[0_18px_38px_-14px_rgba(4,12,36,0.34)] ring-1 ring-line',
          'focus:outline-none',
          className,
        )}
      />
    </PopoverPrimitive.Portal>
  )
})

/* --- Select --------------------------------------------------------------- */

export interface SelectOption {
  value: string
  label: string
}

/* One composed control rather than eight exported parts. Every select in this
   app is the same shape - a pill, a caret, a flat list of options - so the
   parts would only ever be reassembled the same way. */
export function Select({
  value,
  onValueChange,
  options,
  label,
  icon,
  className,
  contentClassName,
  disabled,
}: {
  value: string
  onValueChange: (v: string) => void
  options: readonly SelectOption[]
  /** Accessible name. These sit next to their own headings, so there is
      rarely a visible <label> to point at. */
  label: string
  /** Optional glyph inside the left edge of the trigger. */
  icon?: ReactNode
  className?: string
  contentClassName?: string
  disabled?: boolean
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        aria-label={label}
        className={cx(
          'inline-flex items-center gap-1.5 rounded-full bg-wash py-1.5 pr-2.5 pl-3',
          'text-[11.5px] font-medium whitespace-nowrap text-navy-900',
          'transition-colors duration-100 hover:bg-navy-50',
          'focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-600',
          'data-[state=open]:bg-navy-50',
          'disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
      >
        {icon && <span className="text-placeholder">{icon}</span>}
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon>
          <CaretDown size={11} weight="bold" className="text-muted" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          collisionPadding={12}
          className={cx(
            'z-50 overflow-hidden rounded-[12px] bg-white p-1',
            'shadow-[0_18px_38px_-14px_rgba(4,12,36,0.34)] ring-1 ring-line',
            contentClassName,
          )}
        >
          <SelectPrimitive.Viewport>
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                className={cx(
                  'flex cursor-pointer items-center gap-2 rounded-[8px] py-1.5 pr-2 pl-2',
                  'text-[11.5px] whitespace-nowrap text-navy-900 select-none',
                  'outline-none data-[highlighted]:bg-wash',
                  'data-[state=checked]:font-medium',
                )}
              >
                {/* Fixed-width slot, so the labels line up whether or not the
                    row is the checked one. */}
                <span className="grid w-3.5 shrink-0 place-items-center">
                  <SelectPrimitive.ItemIndicator>
                    <Check size={11} weight="bold" className="text-navy-800" />
                  </SelectPrimitive.ItemIndicator>
                </span>
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}
