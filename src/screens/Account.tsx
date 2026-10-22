import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Buildings, FirstAidKit, Key, LockKey, Warning } from '@phosphor-icons/react'
import { PasswordField, cx } from '@/components/ui'
import { Modal, ModalCloseButton, ModalContent, ModalDescription, ModalTitle } from '@/components/primitives'
import { RecoveryCodesDialog, useRecoveryCodes } from '@/components/RecoverySettings'
import { toast } from '@/components/toast'
import { useQuery } from '@/lib/query'
import { ApiError, endpoints } from '@/lib/api'
import { formatDate } from '@/lib/dates'

/* My account: the signed-in person's own account, head or nurse.

   THE SHAPE (2026-10-14, the user asked for a more standard, professional
   page): a header card with who is signed in, then two panels. Since
   2026-10-15 they are one centred column, like New school year.
   "Account details" is read-only facts. "Sign-in and security" is a list of
   rows - Password, Recovery codes - each with a label, one line of status
   and one button on the right, the way most account settings pages are laid
   out. Name, username and role are changed by the school head on Roles. */

const ROLE: Record<string, string> = { ADMIN: 'School head', NURSE: 'School nurse' }

function initialsOf(fullName: string): string {
  const words = fullName
    .replace(/^(Mrs|Mr|Ms|Dr)\.?\s+/i, '')
    .split(/\s+/)
    .filter((w) => w && !/^[A-Za-z]\.$/.test(w))
  return ((words[0]?.[0] ?? '') + (words.length > 1 ? (words[words.length - 1][0] ?? '') : '')).toUpperCase()
}

function dateTime(iso: string | null): string {
  if (!iso) return 'Not yet'
  const d = new Date(iso)
  return `${formatDate(iso)}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

export default function Account() {
  const me = useQuery('me', endpoints.me).data?.user
  const codes = useRecoveryCodes().data
  const [changingPassword, setChangingPassword] = useState(false)
  const [makingCodes, setMakingCodes] = useState(false)

  if (!me) return null
  const admin = me.role === 'ADMIN'

  const codesStatus = !codes
    ? 'Loading'
    : codes.total === 0
      ? 'Not set up'
      : `${codes.remaining} of ${codes.total} codes available${codes.createdAt ? ` · Created ${formatDate(codes.createdAt)}` : ''}`
  const codesLow = codes ? codes.remaining <= 2 : false

  return (
    <div className="h-full overflow-auto px-6 pt-1 pb-8">
      {/* Centred in one column, like New school year (2026-10-15). */}
      <div className="mx-auto max-w-[760px] space-y-4">
        {/* --- Who is signed in --- */}
        <section className="panel flex flex-wrap items-center gap-4 px-6 py-5">
          <span className="grid size-14 shrink-0 place-items-center rounded-full bg-navy-700 text-[17px] font-semibold text-white">
            {initialsOf(me.fullName)}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-[20px] leading-tight font-bold tracking-[-0.01em] text-navy-900">
              {me.fullName}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-muted">
              <span className="inline-flex items-center gap-1 rounded-full bg-navy-50 px-2 py-0.5 text-[11px] font-semibold text-navy-700">
                {admin ? <Buildings size={11} weight="fill" /> : <FirstAidKit size={11} weight="fill" />}
                {ROLE[me.role] ?? me.role}
              </span>
              <span className="font-mono">{me.username}</span>
            </div>
          </div>
        </section>

        <div className="space-y-4">
          {/* --- Account details --- */}
          <section className="panel h-fit px-6 py-5">
            <h3 className="text-[14px] font-semibold text-navy-900">Account details</h3>
            <dl className="mt-4 divide-y divide-line-soft text-[12.5px]">
              {[
                ['Full name', me.fullName],
                ['Username', me.username],
                ['Role', ROLE[me.role] ?? me.role],
                ['Access', admin ? 'All sections, full access' : 'All sections, health records'],
                ['Last signed in', dateTime(me.lastLoginAt)],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                  <dt className="shrink-0 text-muted">{k}</dt>
                  <dd className="text-right font-medium text-navy-900">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 border-t border-line-soft pt-3.5 text-[11.5px] leading-relaxed text-muted">
              {admin
                ? 'Name, username and role are managed on the Roles screen.'
                : 'To change your name, username or role, contact the school head.'}
            </p>
          </section>

          {/* --- Sign-in and security --- */}
          <section className="panel h-fit px-6 py-5">
            <h3 className="text-[14px] font-semibold text-navy-900">Sign-in and security</h3>
            <div className="mt-4 divide-y divide-line-soft">
              <SecurityRow
                icon={<LockKey size={17} weight="fill" />}
                title="Password"
                status="Used to sign in to CHAS."
                action="Change password"
                onAction={() => setChangingPassword(true)}
              />
              <SecurityRow
                icon={<Key size={17} weight="fill" />}
                title="Recovery codes"
                status={codesStatus}
                warn={codes ? codes.total === 0 || codesLow : false}
                action={codes && codes.total > 0 ? 'Create new codes' : 'Set up'}
                primary={codes ? codes.total === 0 : false}
                disabled={!codes}
                onAction={() => setMakingCodes(true)}
              />
            </div>
            <p className="mt-4 rounded-[12px] bg-wash px-4 py-3 text-[11.5px] leading-relaxed text-muted">
              <span className="font-semibold text-navy-900">Forgot your password?</span> Select Forgot
              password? on the sign-in screen and enter one of your recovery codes.{' '}
              {admin
                ? 'Without a code, another school head can set a new password on the Roles screen.'
                : 'Without a code, ask the school head to set a new password.'}
            </p>
          </section>
        </div>
      </div>

      <ChangePasswordDialog open={changingPassword} onOpenChange={setChangingPassword} />
      <RecoveryCodesDialog
        open={makingCodes}
        onOpenChange={setMakingCodes}
        mode={codes && codes.total > 0 ? 'replace' : 'setup'}
        owner={`${me.fullName} (${me.username})`}
      />
    </div>
  )
}

function SecurityRow({
  icon,
  title,
  status,
  warn,
  action,
  primary,
  disabled,
  onAction,
}: {
  icon: ReactNode
  title: string
  status: string
  warn?: boolean
  action: string
  primary?: boolean
  disabled?: boolean
  onAction: () => void
}) {
  return (
    <div className="flex items-center gap-3.5 py-3.5 first:pt-0 last:pb-0">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-navy-50 text-navy-700">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-navy-900">{title}</div>
        <div className={cx('mt-0.5 flex items-center gap-1.5 text-[12px]', warn ? 'text-gold-700' : 'text-muted')}>
          {warn && <Warning size={13} weight="fill" className="shrink-0" />}
          {status}
        </div>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={onAction}
        className={cx(
          'h-9 shrink-0 rounded-[10px] px-4 text-[12.5px] font-semibold transition-colors duration-100 disabled:opacity-40',
          primary ? 'bg-navy-900 text-white hover:bg-navy-800' : 'bg-wash text-navy-900 hover:bg-navy-50',
        )}
      >
        {action}
      </button>
    </div>
  )
}

const FIELD = 'h-11 rounded-[12px] text-[13.5px]'

function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setCurrent('')
    setNext('')
    setConfirm('')
    setError(null)
  }, [open])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!current) return setError('Enter your current password.')
    if (next.length < 12) return setError('The new password needs at least twelve characters.')
    if (next !== confirm) return setError('The two new passwords do not match.')
    if (next === current) return setError('The new password must be different from the current one.')
    setBusy(true)
    setError(null)
    try {
      await endpoints.changePassword(current, next)
      onOpenChange(false)
      toast.success('Your password was changed.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="max-w-[440px]">
        <form onSubmit={submit} noValidate className="px-7 pt-7 pb-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <ModalTitle className="font-display text-[20px] leading-tight font-bold tracking-[-0.02em] text-navy-900">
                Change password
              </ModalTitle>
              <ModalDescription className="mt-2 text-[12.5px] leading-relaxed text-muted">
                Use at least twelve characters. You stay signed in on this computer.
              </ModalDescription>
            </div>
            <ModalCloseButton />
          </div>

          <div className="mt-5 space-y-4">
            <PasswordField
              label="Current password"
              autoComplete="current-password"
              autoFocus
              value={current}
              inputClassName={FIELD}
              onChange={(e) => setCurrent(e.target.value)}
            />
            <PasswordField
              label="New password"
              autoComplete="new-password"
              placeholder="At least twelve characters"
              value={next}
              inputClassName={FIELD}
              onChange={(e) => setNext(e.target.value)}
            />
            <PasswordField
              label="Confirm new password"
              autoComplete="new-password"
              value={confirm}
              inputClassName={FIELD}
              onChange={(e) => setConfirm(e.target.value)}
            />
            {error && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-[10px] bg-[#fdf2f5] px-3 py-2.5 text-[12px] leading-relaxed font-medium text-[#9f1239]"
              >
                <Warning size={15} weight="fill" className="mt-px shrink-0" />
                {error}
              </p>
            )}
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="h-10 rounded-[10px] px-4 text-[12.5px] font-medium text-muted transition-colors duration-100 hover:bg-wash hover:text-navy-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="h-10 rounded-[10px] bg-navy-900 px-5 text-[12.5px] font-semibold text-white transition-colors duration-100 hover:bg-navy-800 disabled:opacity-40"
            >
              {busy ? 'Saving…' : 'Change password'}
            </button>
          </div>
        </form>
      </ModalContent>
    </Modal>
  )
}
