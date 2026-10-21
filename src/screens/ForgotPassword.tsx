import { useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, Key, LockKey, User, Warning } from '@phosphor-icons/react'
import { AccentButton, Field, cx } from '../components/ui'
import { ApiError, OfflineError, endpoints } from '../lib/api'

/* Forgot password, inside the sign-in card.

   TWO WAYS BACK IN, both offline:

     1. A recovery code from the sheet the account holder printed on My
        account. Head and nurse alike. Each code works once.
     2. The school head sets a new password on the Roles screen. Said under
        the form, for whoever has no codes left.

   Email reset was built and removed (2026-10-14): CHAS runs on one machine
   without internet, and a way in that needs both is not one to rely on. */

const fieldClass = cx(
  'h-11 rounded-[12px] text-[13.5px]',
  'border-transparent bg-wash hover:border-transparent focus:border-navy-600 focus:bg-white',
)

const LINK =
  'rounded-full px-2 py-1 text-[12px] font-medium text-navy-700 transition-colors duration-100 hover:bg-wash hover:text-navy-900'

export default function ForgotPassword({
  initialUsername,
  onDone,
  onCancel,
}: {
  initialUsername: string
  /** Back to sign-in, with a line to show there. */
  onDone: (username: string, message: string) => void
  onCancel: () => void
}) {
  const [username, setUsername] = useState(initialUsername)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!username.trim()) return setError('Enter your username.')
    if (!code.trim()) return setError('Enter a recovery code.')
    if (password.length < 12) return setError('The new password needs at least twelve characters.')
    if (password !== confirm) return setError('The two passwords do not match.')

    setPending(true)
    setError(null)
    try {
      const { remaining } = await endpoints.resetWithRecoveryCode(username.trim(), code.trim(), password)
      onDone(
        username.trim(),
        remaining > 2
          ? `Password changed. ${remaining} recovery codes left.`
          : remaining > 0
            ? `Password changed. Only ${remaining} recovery code${remaining === 1 ? '' : 's'} left. Create new ones on My account.`
            : 'Password changed. No recovery codes left. Create new ones on My account.',
      )
    } catch (err) {
      if (err instanceof OfflineError || err instanceof ApiError) setError(err.message)
      else setError('Something went wrong. Try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mt-7">
      <h2 className="text-center text-[15px] font-semibold text-navy-900">Reset password</h2>
      <p className="mt-1.5 text-center text-[12px] leading-relaxed text-muted">
        Enter one of the recovery codes printed from My account.
      </p>

      <form className="mt-5 space-y-4" onSubmit={submit} noValidate>
        <Field
          label="Username"
          placeholder="Enter your username"
          autoComplete="username"
          autoFocus={!username}
          spellCheck={false}
          value={username}
          leading={<User size={16} />}
          inputClassName={fieldClass}
          onChange={(e) => setUsername(e.target.value)}
        />
        <Field
          label="Recovery code"
          placeholder="XXXX-XXXX-XXXX"
          autoComplete="off"
          autoFocus={Boolean(username)}
          spellCheck={false}
          value={code}
          leading={<Key size={16} weight="fill" />}
          inputClassName={cx(fieldClass, 'font-mono uppercase')}
          onChange={(e) => setCode(e.target.value)}
        />
        <Field
          label="New password"
          type="password"
          placeholder="At least twelve characters"
          autoComplete="new-password"
          value={password}
          leading={<LockKey size={16} weight="fill" />}
          inputClassName={fieldClass}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Field
          label="Confirm new password"
          type="password"
          placeholder="Type it again"
          autoComplete="new-password"
          value={confirm}
          leading={<LockKey size={16} weight="fill" />}
          inputClassName={fieldClass}
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

        <AccentButton type="submit" disabled={pending} className="h-11 w-full rounded-full text-[14px]">
          {pending ? 'Saving…' : 'Set new password'}
          {!pending && <ArrowRight size={16} weight="bold" />}
        </AccentButton>

        <p className="text-center text-[11.5px] leading-relaxed text-muted">
          No recovery codes? Ask the school head to set a new password.
        </p>
      </form>

      <div className="mt-3 flex justify-center">
        <button type="button" className={cx(LINK, 'inline-flex items-center gap-1')} onClick={onCancel}>
          <ArrowLeft size={13} weight="bold" />
          Back to sign in
        </button>
      </div>
    </div>
  )
}
