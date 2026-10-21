import type { ReactNode } from 'react'
import { Modal, ModalClose, ModalContent, ModalDescription, ModalTitle } from './primitives'
import { Y, isFlagged } from './bento'
import { TODAY, type Learner } from '@/data/mock'

/* Starting and ending a follow-up weigh-in (2026-10-11).

   Deliberately one question each, after the user found a dialog with groups,
   a grade filter and a start date too complex: a follow-up weigh-in is always
   "weigh again the learners who need monitoring, from today". Nothing is
   erased; the baseline and endline the SF8 reads are not changed. */

/** The learners a follow-up weigh-in takes: measured, and not Normal. */
export const needsFollowUp = (l: Learner) => Boolean(l.measuredOn) && isFlagged(l)

export function StartFollowUpDialog({
  open,
  onOpenChange,
  learners,
  onStart,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  learners: Learner[]
  onStart: (f: { label: string; startedOn: string; learnerIds: string[] }) => void
}) {
  const chosen = learners.filter(needsFollowUp)
  const n = chosen.length
  return (
    <Confirm
      open={open}
      onOpenChange={onOpenChange}
      title="Follow-up weigh-in"
      body={
        n === 0
          ? 'No learners need monitoring.'
          : `Weigh again the ${n} learner${n === 1 ? '' : 's'} who need monitoring? Earlier measurements are kept.`
      }
      action="Start"
      primary
      disabled={n === 0}
      onConfirm={() => onStart({ label: 'Follow-up weigh-in', startedOn: TODAY, learnerIds: chosen.map((l) => l.id) })}
    />
  )
}

export function EndFollowUpDialog({
  open,
  onOpenChange,
  measured,
  total,
  onEnd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  measured: number
  total: number
  onEnd: () => void
}) {
  return (
    <Confirm
      open={open}
      onOpenChange={onOpenChange}
      title="End the follow-up weigh-in?"
      body={`${measured} of ${total} measured.`}
      action="End"
      onConfirm={onEnd}
    />
  )
}

function Confirm({
  open,
  onOpenChange,
  title,
  body,
  action,
  primary,
  disabled,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  body: ReactNode
  action: string
  primary?: boolean
  disabled?: boolean
  onConfirm: () => void
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      {open && (
        <ModalContent className="max-w-[400px]">
          <div className="px-6 pt-5 pb-5">
            <ModalTitle className="font-display text-[17px] font-semibold text-navy-900">{title}</ModalTitle>
            <ModalDescription className="mt-2 text-[13px] leading-snug text-muted">{body}</ModalDescription>
            <div className="mt-5 flex justify-end gap-2">
              <ModalClose className="h-10 rounded-[12px] bg-wash px-5 text-[13px] font-semibold text-navy-900 transition-colors duration-100 hover:bg-navy-50">
                Cancel
              </ModalClose>
              <button
                type="button"
                disabled={disabled}
                onClick={onConfirm}
                className={
                  primary
                    ? 'h-10 rounded-[12px] px-6 text-[13px] font-bold text-[#071539] transition-[filter] duration-100 hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50'
                    : 'h-10 rounded-[12px] bg-navy-900 px-6 text-[13px] font-bold text-white transition-colors duration-100 hover:bg-navy-800'
                }
                style={primary ? { background: Y } : undefined}
              >
                {action}
              </button>
            </div>
          </div>
        </ModalContent>
      )}
    </Modal>
  )
}
