import { useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, LockKey, Warning } from '@phosphor-icons/react'
import { AccentButton, PasswordField, cx } from '../components/ui'
import { ApiError, OfflineError, endpoints } from '../lib/api'

/* A new password, inside the sign-in card, before anything else opens.

   Shown after signing in with a password somebody else set: the published
   first-launch defaults, or one the head gave when creating or resetting the
   account. The server answers nothing but this change until it is made
   (requireAuth, PASSWORD_CHANGE_REQUIRED), so there is nothing to skip to.

   The current password is the one just typed on the sign-in form, so it is
   not asked for again. */

const fieldClass = cx(
  'h-11 rounded-[12px] text-[13.5px]',
  'border-transparent bg-wash hover:border-transparent focus:border-navy-600 focus:bg-white',
)

export default function SetNewPassword({
  currentPassword,
  onDone,
  onCancel,
}: {
  currentPassword: string
  onDone: () => Promise<void> | void
  /** Back to sign-in; the session is ended by the caller. */
  onCancel: () => void
}) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (password.length < 12) return setError('The new password needs at least twelve characters.')
    if (password !== confirm) return setError('The two passwords do not match.')
    if (password === currentPassword) return setError('Choose a password different from the current one.')

    setPending(true)
    setError(null)
    try {
      await endpoints.changePassword(currentPassword, password)
      await onDone()
    } catch (err) {
      if (err instanceof OfflineError || err instanceof ApiError) setError(err.message)
      else setError('Something went wrong. Try again.')
      setPending(false)
    }
  }

  return (
    <div className="mt-7">
      <h2 className="text-center text-[15px] font-semibold text-navy-900">Set a new password</h2>
      <p className="mt-1.5 text-center text-[12px] leading-relaxed text-muted">
        This account has a temporary password. Set a new one to continue.
      </p>

      <form className="mt-5 space-y-4" onSubmit={submit} noValidate>
        <PasswordField
          label="New password"
          placeholder="At least twelve characters"
          autoComplete="new-password"
          autoFocus
          value={password}
          leading={<LockKey size={16} weight="fill" />}
          inputClassName={fieldClass}
          onChange={(e) => setPassword(e.target.value)}
        />
        <PasswordField
          label="Confirm new password"
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
          {pending ? 'Saving…' : 'Save and continue'}
          {!pending && <ArrowRight size={16} weight="bold" />}
        </AccentButton>
      </form>

      <div className="mt-3 flex justify-center">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-medium text-navy-700 transition-colors duration-100 hover:bg-wash hover:text-navy-900"
          onClick={onCancel}
        >
          <ArrowLeft size={13} weight="bold" />
          Back to sign in
        </button>
      </div>
    </div>
  )
}
