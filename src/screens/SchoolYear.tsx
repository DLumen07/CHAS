import { useState, type ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { ArrowCounterClockwise, CheckCircle, GraduationCap, WarningCircle } from '@phosphor-icons/react'
import { cx } from '@/components/ui'
import { PrimaryButton } from '@/components/SlipWizard'
import RolloverWizard from '@/components/RolloverWizard'
import { ConfirmDialog } from '@/components/primitives'
import { toast } from '@/components/toast'
import { TODAY } from '@/data/mock'
import { isAdmin, useRoster } from '@/lib/records'
import { endpoints } from '@/lib/api'
import { useQuery } from '@/lib/query'
import { refresh } from '@/lib/server-records'
import { inRound } from '@/lib/rounds'
import { schoolYearStart } from '@/lib/school-year'
import { formatDateTime } from '@/lib/dates'

/* The school year, and moving the school into the next one. Head only.

   The page is the year as it stands - a navy card with the one action - and
   the three things worth doing before closing it: finish the endline
   weigh-in, export the SF8, back up. None of them blocks the button; a head
   who knows the SF8 went out last week does not need the app to insist.

   After a rollover the same page offers to undo it, for as long as nothing
   has been recorded in the new year (the server decides, and says why not). */

/* Redirected before the year is fetched: the endpoint is the head's, and
   asking for it first only earned the nurse a 403 on the way out. */
export default function SchoolYear() {
  const { install, ready } = useRoster()
  if (!ready) return null
  if (!isAdmin(install)) return <Navigate to="/admin" replace />
  return <Year />
}

function Year() {
  const { learners } = useRoster()
  const q = useQuery('school-year', endpoints.schoolYear)
  const year = q.data
  const [wizard, setWizard] = useState(false)
  const [undoOpen, setUndoOpen] = useState(false)
  const [undoing, setUndoing] = useState(false)

  /* The endline round of the year being closed: January to May. */
  const start = year ? schoolYearStart(year.schoolYear) : 0
  const endline = { key: 'endline' as const, label: '', from: `${start + 1}-01-01`, to: `${start + 1}-05-31` }
  const endlineDone = learners.filter((l) => inRound(l.measuredOn, endline)).length
  const early = year ? TODAY < `${start + 1}-03-01` : false
  const sections = new Set(learners.map((l) => l.section)).size

  async function undo() {
    if (!year?.lastRollover) return
    setUndoing(true)
    try {
      const r = await endpoints.undoRollover(year.lastRollover.id)
      await refresh()
      toast.success(`Restored to S.Y. ${r.schoolYear}.`)
      setUndoOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to undo the change.')
    } finally {
      setUndoing(false)
    }
  }

  return (
    <div className="h-full overflow-auto px-6 pt-1 pb-8">
      <div className="mx-auto max-w-[980px] space-y-5">
        {/* --- The year, and the one action ------------------------------- */}
        <section
          className="relative overflow-hidden rounded-[20px] px-6 py-5 text-white"
          style={{ background: 'linear-gradient(120deg, #2b52c4 0%, #1b3a92 50%, #0e2464 100%)' }}
        >
          <span aria-hidden className="pointer-events-none absolute -top-24 -right-16 size-64 rounded-full bg-white/[0.06]" />
          <div className="relative flex flex-wrap items-center gap-5">
            <span className="grid size-14 shrink-0 place-items-center rounded-[16px] bg-white/10">
              <GraduationCap size={28} weight="fill" className="text-seal-yellow" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] text-white/70">Current school year</div>
              <div className="mt-0.5 font-display text-[22px] leading-tight font-semibold tracking-[-0.01em]">
                S.Y. {year?.schoolYear ?? '…'}
              </div>
              <div className="tnum mt-1 text-[12.5px] text-white/80">
                {learners.length} learners in {sections} {sections === 1 ? 'class' : 'classes'}
              </div>
            </div>
            <PrimaryButton onClick={() => setWizard(true)} disabled={!year}>
              <GraduationCap size={15} weight="bold" />
              Start S.Y. {year?.nextYear ?? 'next year'}
            </PrimaryButton>
          </div>
        </section>

        {q.error != null && (
          <p className="rounded-[12px] bg-[#fdf2f5] px-4 py-3 text-[12.5px] text-[#9f1239]">
            {q.error instanceof Error ? q.error.message : 'Unable to load the school year.'}
          </p>
        )}

        {/* --- Undo the last change --------------------------------------- */}
        {year?.lastRollover && (
          <section className="panel flex flex-wrap items-start gap-4 px-5 py-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-navy-50 text-navy-700">
              <ArrowCounterClockwise size={18} weight="bold" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-[14px] font-semibold text-navy-900">
                Started S.Y. {year.lastRollover.toYear}
              </h3>
              <p className="mt-0.5 text-[12px] text-muted">
                By {year.lastRollover.by} on {formatDateTime(year.lastRollover.rolledAt)}. Closed S.Y.{' '}
                {year.lastRollover.fromYear}.
              </p>
              {year.lastRollover.blockers.length > 0 && (
                <p className="mt-2 text-[12px] leading-relaxed text-muted">
                  Undo is no longer available. {year.lastRollover.blockers[0]}
                </p>
              )}
            </div>
            {year.lastRollover.blockers.length === 0 && (
              <button
                type="button"
                onClick={() => setUndoOpen(true)}
                className="h-9 shrink-0 rounded-full px-4 text-[12.5px] font-medium text-navy-800 shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors duration-100 hover:bg-wash"
              >
                Undo
              </button>
            )}
          </section>
        )}

        {/* --- Before closing the year ------------------------------------ */}
        <section className="panel px-5 py-4">
          <h3 className="text-[14px] font-semibold text-navy-900">Before starting a new school year</h3>
          <p className="mt-0.5 text-[12px] text-muted">Recommended steps before closing the school year.</p>
          <ul className="mt-3 divide-y divide-line-soft">
            <Check
              ok={learners.length > 0 && endlineDone === learners.length}
              title="Complete the endline weigh-in"
              body={`${endlineDone} of ${learners.length} learners measured in the endline round (January to May ${start + 1}).`}
              action={<Link to="/weigh-in">Weigh-in</Link>}
            />
            <Check
              title="Export the SF8 for each grade"
              body="The SF8 export shows only the current school year."
              action={<Link to="/sf8">SF8 export</Link>}
            />
            <Check
              title="Back up the records"
              body="Create a backup before closing the school year."
              action={<Link to="/backup">Backup</Link>}
            />
            {early && (
              <Check
                warn
                title="School year in progress"
                body={`S.Y. ${year?.schoolYear} ends in May ${start + 1}.`}
              />
            )}
          </ul>
        </section>
      </div>

      {year && (
        <RolloverWizard
          open={wizard}
          onOpenChange={setWizard}
          year={year}
          learners={learners}
          onDone={(toYear) => {
            setWizard(false)
            void refresh()
            toast.success(`S.Y. ${toYear} has started.`)
          }}
        />
      )}

      <ConfirmDialog
        open={undoOpen}
        onOpenChange={setUndoOpen}
        title={`Go back to S.Y. ${year?.lastRollover?.fromYear ?? ''}?`}
        body={
          <>
            All learners return to their previous classes, removed learners are restored to the roster, and
            the advisers and parent meeting are restored.
          </>
        }
        confirmLabel="Undo the change"
        tone="danger"
        busy={undoing}
        onConfirm={() => void undo()}
      />
    </div>
  )
}

function Check({
  ok,
  warn,
  title,
  body,
  action,
}: {
  ok?: boolean
  warn?: boolean
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <li className="flex items-start gap-3 py-3">
      {warn ? (
        <WarningCircle size={18} weight="fill" className="mt-px shrink-0 text-gold-700" />
      ) : (
        <CheckCircle size={18} weight="fill" className={cx('mt-px shrink-0', ok ? 'text-[var(--color-n)]' : 'text-[#c5cedd]')} />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium text-navy-900">{title}</div>
        <div className="mt-0.5 text-[12px] leading-relaxed text-muted">{body}</div>
      </div>
      {action && (
        <span className="shrink-0 text-[12px] font-medium text-navy-600 hover:text-navy-900 [&>a]:underline-offset-2 hover:[&>a]:underline">
          {action}
        </span>
      )}
    </li>
  )
}
