import { useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import {
  ArrowCounterClockwise,
  CheckCircle,
  ClockCounterClockwise,
  Database,
  FloppyDisk,
  Info,
  LockKey,
  Usb,
  Warning,
} from '@phosphor-icons/react'
import { AccentButton, Button, Field, IconChip, Panel, cx } from '@/components/ui'
import { Modal, ModalCloseButton, ModalContent, ModalDescription, ModalTitle } from '@/components/primitives'
import { ApiError, endpoints } from '@/lib/api'
import { backupBridge, type AutomaticBackup, type RestoreOutcome } from '@/lib/backup'
import { formatDateTime } from '@/lib/dates'
import { isAdmin, useRoster } from '@/lib/records'

/* Backup and restore, for the installed app: one computer, its own database.

   A BACKUP is a full copy of the database - every account, measurement,
   correction, slip and audit line - written to a folder the head chooses,
   ideally a USB drive kept away from the computer. The app pauses for a few
   seconds while it is made (see server/desktop.ts for why the database is
   stopped to copy it).

   A RESTORE replaces the records on this computer with a backup folder. The
   system asks for confirmation in its own dialog, a copy of the current
   records is kept on the machine, and CHAS restarts on the restored copy. If
   that copy will not open, the previous records are put back on their own.

   BOTH ASK FOR THE PASSWORD FIRST (2026-10-14, on an IT reviewer's advice).
   A backup puts every learner's health record on a drive that can leave the
   room, and a restore replaces every record here; neither should be one
   click on a computer left signed in. The server checks the password
   (/auth/confirm-password) and logs both outcomes.

   AUTOMATIC BACKUPS (2026-10-17) are made each time CHAS closes and kept on
   this computer for seven days (server/desktop.ts). They need no button, so
   the screen only says when the last one was made. They undo a mistake; they
   do not survive the computer, which is what the USB backup is for. */

type Note = { tone: 'ok' | 'warn'; text: string }

export default function ServerBackup() {
  const { install, ready, learners } = useRoster()
  const [note, setNote] = useState<Note | null>(null)
  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null)
  const [lastRestore, setLastRestore] = useState<RestoreOutcome | null>(null)
  const [lastBackup, setLastBackup] = useState<string | null>(null)
  const [lastAutomatic, setLastAutomatic] = useState<AutomaticBackup | null>(null)
  /* Which action is waiting on the password. */
  const [asking, setAsking] = useState<'backup' | 'restore' | null>(null)

  useEffect(() => {
    backupBridge
      ?.status()
      .then((s) => {
        setLastRestore(s.lastRestore)
        setLastAutomatic(s.lastAutomatic ?? null)
      })
      .catch(() => {})
  }, [])

  if (ready && !isAdmin(install)) return <Navigate to="/admin" replace />

  const measured = learners.filter((l) => l.measuredOn).length

  async function backUp() {
    if (!backupBridge) return
    setBusy('backup')
    setNote(null)
    try {
      const r = await backupBridge.create()
      if (r.ok) {
        setLastBackup(r.folder)
        setNote({
          tone: 'ok',
          text: `Backup saved: ${r.learners} learners and ${r.measurements} measurements, in ${r.folder}. Keep the drive somewhere safe, away from this computer.`,
        })
      } else if (r.reason === 'error') {
        setNote({ tone: 'warn', text: r.message ?? 'The backup could not be made.' })
      }
    } finally {
      setBusy(null)
    }
  }

  async function restore() {
    if (!backupBridge) return
    setBusy('restore')
    setNote(null)
    try {
      /* On success the app restarts and this screen never sees the answer. */
      const r = await backupBridge.restore()
      if (!r.ok && r.reason === 'error') {
        setNote({ tone: 'warn', text: r.message ?? 'The backup could not be restored. Nothing was changed.' })
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="h-full overflow-auto px-6 pt-1 pb-8">
      {/* Centred in one column, like New school year (2026-10-15). */}
      <div className="mx-auto max-w-[760px]">
        {lastRestore && (
          <Callout tone={lastRestore.ok ? 'ok' : 'warn'}>
            {lastRestore.ok ? (
              <>
                <span className="font-semibold">Restored on {formatDateTime(lastRestore.at)}</span> from the
                backup made {lastRestore.backupDate ? formatDateTime(lastRestore.backupDate) : 'earlier'}.
              </>
            ) : (
              <>
                <span className="font-semibold">The restore on {formatDateTime(lastRestore.at)} failed</span>,
                and the previous records were restored.
              </>
            )}
          </Callout>
        )}

        {note && <Callout tone={note.tone}>{note.text}</Callout>}

        {!backupBridge && (
          <Callout tone="info">
            Backup and restore are available only in the installed CHAS app.
          </Callout>
        )}

        <div className="space-y-4">
          <Panel
            className="h-fit"
            title={
              <span className="flex items-center gap-2">
                <IconChip tone="navy">
                  <FloppyDisk size={14} weight="fill" />
                </IconChip>
                Back up the records
              </span>
            }
            subtitle="A full copy of everything on this computer"
          >
            <ul className="space-y-1">
              {[
                { label: 'Registered learners', n: learners.length },
                { label: 'With a measurement', n: measured },
              ].map((c) => (
                <li
                  key={c.label}
                  className="flex items-baseline justify-between gap-3 rounded-[10px] px-3 py-2 odd:bg-wash"
                >
                  <span className="text-[12px] text-navy-900">{c.label}</span>
                  <span className="tnum text-[13px] font-semibold text-navy-900">{ready ? c.n : '—'}</span>
                </li>
              ))}
            </ul>

            {backupBridge && (
              <div className="mt-3 flex items-start gap-2.5 rounded-[12px] border border-line px-3.5 py-3">
                <ClockCounterClockwise size={16} weight="bold" className="mt-px shrink-0 text-navy-700" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="text-[12px] font-semibold text-navy-900">Automatic backup</span>
                    <span className="tnum text-[12px] text-navy-900">
                      {lastAutomatic ? formatDateTime(lastAutomatic.createdAt) : 'Not yet made'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">
                    Made each time CHAS closes. The last 7 days are kept on this computer.
                  </p>
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <AccentButton
                onClick={() => setAsking('backup')}
                disabled={!backupBridge || busy !== null}
                icon={<Database size={15} weight="bold" />}
              >
                {busy === 'backup' ? 'Backing up…' : 'Back up now'}
              </AccentButton>
            </div>

            <div className="mt-3 flex items-start gap-2.5 rounded-[12px] bg-wash px-3.5 py-3">
              <Usb size={16} weight="fill" className="mt-px shrink-0 text-navy-700" />
              <p className="text-[11.5px] leading-relaxed text-muted">
                Automatic backups are lost if this computer is lost or damaged. Choose a{' '}
                <span className="font-semibold text-navy-900">USB drive</span> when asked, after each
                weigh-in and at least once a month. CHAS pauses briefly during the backup.
              </p>
            </div>
            {lastBackup && (
              <p className="mt-2 text-[11px] text-muted">
                Most recent backup: <span className="text-navy-900">{lastBackup}</span>
              </p>
            )}
          </Panel>

          <Panel
            className="h-fit"
            title={
              <span className="flex items-center gap-2">
                <IconChip tone="gold">
                  <ArrowCounterClockwise size={14} weight="bold" />
                </IconChip>
                Restore from a backup
              </span>
            }
            subtitle="Replace the records on this computer with a backup"
          >
            <p className="text-[12px] leading-relaxed text-muted">
              Choose a <span className="font-semibold text-navy-900">CHAS-backup</span> folder. The
              records on this computer are replaced by the backup, and CHAS restarts. Users sign in
              with the passwords in effect when the backup was made.
            </p>

            <div className="mt-3 flex items-start gap-2.5 rounded-[12px] bg-gold-100 px-3.5 py-3">
              <Warning size={16} weight="fill" className="mt-px shrink-0 text-gold-700" />
              <p className="text-[11.5px] leading-relaxed text-gold-700">
                Records saved after the backup was made will be lost. If the backup cannot be opened,
                CHAS restores the current records automatically.
              </p>
            </div>

            <div className="mt-4">
              <Button
                variant="danger"
                onClick={() => setAsking('restore')}
                disabled={!backupBridge || busy !== null}
                icon={<ArrowCounterClockwise size={15} weight="bold" />}
              >
                {busy === 'restore' ? 'Select a backup folder…' : 'Restore a backup…'}
              </Button>
            </div>
          </Panel>
        </div>
      </div>

      <ConfirmPasswordDialog
        purpose={asking}
        onClose={() => setAsking(null)}
        onConfirmed={(purpose) => {
          setAsking(null)
          void (purpose === 'backup' ? backUp() : restore())
        }}
      />
    </div>
  )
}

function ConfirmPasswordDialog({
  purpose,
  onClose,
  onConfirmed,
}: {
  purpose: 'backup' | 'restore' | null
  onClose: () => void
  onConfirmed: (purpose: 'backup' | 'restore') => void
}) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setPassword('')
    setError(null)
  }, [purpose])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!purpose) return
    if (!password) return setError('Enter your password.')
    setBusy(true)
    setError(null)
    try {
      await endpoints.confirmPassword(password, purpose)
      onConfirmed(purpose)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.')
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={purpose !== null} onOpenChange={(o) => !o && onClose()}>
      <ModalContent className="max-w-[420px]">
        <form onSubmit={submit} noValidate className="px-7 pt-7 pb-6">
          <div className="flex items-start justify-between gap-3">
            <span className="grid size-12 place-items-center rounded-full bg-navy-50 text-navy-700">
              <LockKey size={22} weight="fill" />
            </span>
            <ModalCloseButton />
          </div>
          <ModalTitle className="mt-4 font-display text-[19px] leading-tight font-bold tracking-[-0.02em] text-navy-900">
            Confirm your password
          </ModalTitle>
          <ModalDescription className="mt-2 text-[12.5px] leading-relaxed text-muted">
            {purpose === 'restore'
              ? 'Restoring replaces all records on this computer. Enter your password to continue.'
              : 'A backup contains the health records of every learner. Enter your password to continue.'}
          </ModalDescription>

          <div className="mt-5">
            <Field
              label="Password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              error={error ?? undefined}
              inputClassName="h-11 rounded-[12px] text-[13.5px]"
              onChange={(e) => {
                setPassword(e.target.value)
                setError(null)
              }}
            />
          </div>

          <div className="mt-6 flex justify-end gap-2">
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
              {busy ? 'Checking…' : purpose === 'restore' ? 'Continue to restore' : 'Continue to backup'}
            </button>
          </div>
        </form>
      </ModalContent>
    </Modal>
  )
}

function Callout({ tone, children }: { tone: 'ok' | 'warn' | 'info'; children: React.ReactNode }) {
  const Icon = tone === 'ok' ? CheckCircle : tone === 'warn' ? Warning : Info
  return (
    <div
      role={tone === 'warn' ? 'alert' : 'status'}
      className={cx(
        'mb-3.5 flex items-start gap-2.5 rounded-[14px] px-4 py-2.5 text-[11.5px] leading-relaxed',
        tone === 'ok' && 'bg-[#f2faf5] text-[#14663a]',
        tone === 'warn' && 'bg-gold-100 text-gold-700',
        tone === 'info' && 'bg-wash text-navy-800',
      )}
    >
      <Icon size={15} weight="fill" className="mt-px shrink-0" />
      <span>{children}</span>
    </div>
  )
}
