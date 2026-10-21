import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Eye,
  EyeSlash,
  User,
  LockKey,
  Warning,
  Buildings,
  FirstAidKit,
  CheckCircle,
} from '@phosphor-icons/react'
import { AccentButton, Field, cx } from '../components/ui'
import { AppLogo } from '../components/AppLogo'
import ForgotPassword from './ForgotPassword'
import {
  useRoster,
  roleOf,
  roleFromServer,
  SERVER_BACKED,
  type Role,
} from '../lib/records'
import { ApiError, OfflineError, endpoints, type ApiUser } from '../lib/api'
import SetNewPassword from './SetNewPassword'
import { refresh, setInstall } from '../lib/server-records'
import { ADMIN, NURSE } from '../data/mock'
import { setSchoolInfo, useSchool, useSchoolYear } from '../lib/school-year'

/* Sign-in.

   THE SHAPE. One small white card, centred on the app's grey-blue ground:
   the mark, a heading, the two fields and the one yellow action. The school's
   name sits under the card. Nothing else - a sign-in screen on a school
   workstation is a door, and a door does not need a brochure beside it.

   It replaces a two-column version with a navy brand panel and roster
   figures. Those figures are the dashboard's first screen a second later, so
   stating them here as well only made the door bigger.

   THE ONE ACTION is the seal's yellow, as it is on every dashboard.

   THE UNHAPPY PATH is all still here: per-field validation, a caps-lock
   warning on a field whose contents cannot be read back, a reveal toggle, and
   a form-level error that names neither field - saying which half of a
   credential was wrong is the oracle that lets an attacker enumerate
   accounts. */

/* Two kinds of install: the school head's and the school nurse's. Both read
   every section. There is no class-adviser install - advisers do not sign in
   to CHAS.

   All of this is the LOCAL build's question. On the server build the account
   knows what it is, and the whole block below disappears. */

/* One half of the install toggle. The radio itself is visually hidden rather
   than removed - the input is what gives the group arrow-key navigation, a
   single tab stop and a name a screen reader can read, and none of that is
   worth re-implementing in order to draw a pill. */
function RoleOption({
  icon,
  title,
  checked,
  onSelect,
}: {
  icon: ReactNode
  title: string
  checked: boolean
  onSelect: () => void
}) {
  return (
    <label
      className={cx(
        'flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full text-[12.5px] font-semibold',
        'transition-[background-color,color,box-shadow] duration-150',
        checked
          ? 'bg-navy-800 text-white shadow-[0_4px_12px_-6px_rgba(14,36,100,0.45)]'
          : 'text-muted hover:text-navy-800',
        'has-[:focus-visible]:shadow-[0_0_0_2px_#fff,0_0_0_4px_var(--color-navy-600)]',
      )}
    >
      <input
        type="radio"
        name="install-role"
        className="sr-only"
        checked={checked}
        onChange={onSelect}
      />
      <span className={checked ? 'text-white/80' : 'text-placeholder'}>{icon}</span>
      {title}
    </label>
  )
}

export default function Login() {
  const nav = useNavigate()

  /* Reading these here also starts the record file loading while the user is
     still typing, so the dashboard is not waiting on disk after the form is
     submitted. */
  const { ready, install, claim } = useRoster()
  const schoolYear = useSchoolYear()
  const school = useSchool()

  /* The year printed under the card is the server's, which the head can move
     on; before sign-in this is the only way to ask it. A failure leaves the
     year the build shipped with. */
  useEffect(() => {
    if (!SERVER_BACKED) return
    endpoints
      .school()
      .then((r) => {
        if (r.schoolYear) setSchoolInfo({ schoolYear: r.schoolYear })
        if (r.school) setSchoolInfo({ school: r.school })
      })
      .catch(() => {})
  }, [])
  /* What this install is for. Only asked on an unclaimed machine; after that
     the answer is on file and is stated rather than asked again. */
  const [role, setRole] = useState<Role>('nurse')

  /* --- Changing what a claimed laptop is for ------------------------------

     The claim is made once, on first sign-in, and until recently it could
     never be unmade. That was deliberate and it was also a dead end: a laptop
     claimed for the wrong post at setup, or handed to somebody else in June,
     had no way back except deleting the records file - which throws away the
     very work the machine exists to hold.

     So the door reopens, but stiffly. Three states rather than a toggle:

       'no'      the claim is stated, with one quiet control beside it
       'confirm' a warning naming whose laptop is being given up
       'open'    the chooser is back, and the claim is rewritten on submit

     The middle state is the point. A confirm that names what is being given
     up is what separates a deliberate reassignment from a mis-click. */
  const [reclaim, setReclaim] = useState<'no' | 'confirm' | 'open'>('no')
  const reclaiming = reclaim === 'open'

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  /* Whose install this will be, once claimed.

     While the chooser is open on an already-claimed machine the answer is the
     one being CHOSEN, not the one on file - otherwise the username hint would
     suggest the old account. */
  const claimedRole: Role = (install && !reclaiming ? roleOf(install) : null) ?? role
  const admin = claimedRole === 'admin'
  /* "Mrs. C. Delos Reyes" -> "c.delosreyes", the shape DepEd accounts use.
     It is a placeholder, not a default: filling the field in would be guessing
     at a credential on the account holder's behalf. */
  const usernameHint = (() => {
    /* On the server build the accounts are the server's, and the nurse's is
       named for the post (s.nurse), not the person - so a hint derived from
       a name would point her at an account that does not exist. */
    if (SERVER_BACKED) return 'Enter your username'
    const picked = admin ? ADMIN.name : NURSE.name
    const name = reclaiming ? picked : (install?.adviser ?? picked)
    if (!name) return 'Enter your username'
    const rest = name
      .trim()
      .replace(/^(Mrs|Mr|Ms|Gng|Bb|G)\.?\s+/i, '')
      .trim()
    const initial = rest.match(/^([A-Za-z])\.?\s+/)
    const given = initial ? initial[1] : (rest.split(/\s+/)[0] ?? '')
    const surname = (initial ? rest.slice(initial[0].length) : rest).trim()
    return `${given[0] ?? ''}.${surname.replace(/\s+/g, '')}`.toLowerCase()
  })()

  const [reveal, setReveal] = useState(false)
  const [caps, setCaps] = useState(false)
  /* Signing in against a server is the one wait on this screen that is real -
     Argon2id is deliberately slow, so a correct password costs ~50ms of CPU
     on top of the round trip. The local build has no such wait and shows
     none. */
  const [pending, setPending] = useState(false)
  /* What the server said. Separate from the per-field errors because it
     belongs to neither field: "that username and password do not match" must
     not point at one of them. */
  const [formError, setFormError] = useState<string | null>(null)
  /* Errors appear on submit, not on every keystroke - a field cannot be
     "wrong" while it is still being filled in. Typing in a marked field
     clears its own message. */
  const [errors, setErrors] = useState<{
    username?: string
    password?: string
  }>({})
  const userRef = useRef<HTMLInputElement>(null)
  /* Forgot password takes the form's place inside the same card. Server
     build only: the local build has no accounts to reset. */
  const [forgot, setForgot] = useState(false)
  /* A line from a finished reset, shown above the form until the next try. */
  const [notice, setNotice] = useState<string | null>(null)

  /* Signed in as a user who must replace a password somebody else set. */
  const [mustChange, setMustChange] = useState<ApiUser | null>(null)

  /* Into the app as the account the server named. */
  async function enter(user: ApiUser) {
    /* The role comes back from the server and is simply believed. This
       is the substantive change from the local build: identity is no
       longer something the machine asserts about itself. */
    const role = roleFromServer(user.role)
    if (!role) {
      await endpoints.signOut().catch(() => {})
      setFormError('This account does not have a valid role. Contact the school head.')
      return
    }
    setInstall({ adviser: user.fullName, section: '', role })
    /* Pull the roster before navigating, so the first screen paints with
       numbers rather than an empty state that fills in a moment later. */
    await refresh()
    /* Both accounts open onto the school-wide overview - the head to
       read it, the nurse to work from it. */
    nav('/admin')
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    setNotice(null)

    const next: typeof errors = {}
    if (!username.trim()) next.username = 'Enter the username for this account.'
    if (!password) next.password = 'Enter your password.'
    setErrors(next)
    if (Object.keys(next).length) {
      if (next.username) userRef.current?.focus()
      return
    }

    if (SERVER_BACKED) {
      setPending(true)
      try {
        const { user } = await endpoints.signIn(username.trim(), password)
        /* A password somebody else set: the new-password panel takes the
           form's place, and the app opens once it is saved. */
        if (user.mustChangePassword) {
          setMustChange(user)
          return
        }
        await enter(user)
      } catch (err) {
        if (err instanceof OfflineError) {
          setFormError(err.message)
        } else if (err instanceof ApiError) {
          setFormError(err.message)
          /* Clear the password on a rejected credential, not on an outage.
             Retyping it after the server was simply unreachable is a
             pointless punishment. */
          if (err.code === 'BAD_CREDENTIALS') setPassword('')
        } else {
          setFormError('Unable to sign in. Try again.')
        }
        userRef.current?.focus()
      } finally {
        setPending(false)
      }
      return
    }

    /* --- The local build ---------------------------------------------------
       Claimed on a fresh machine, and RE-claimed on one whose keeper has just
       been changed on purpose. Nothing else rewrites this. */
    if (!install || reclaiming) {
      const who = admin ? ADMIN : NURSE
      claim({ adviser: who.name, section: '', role: claimedRole })
    }
    nav('/admin')
  }

  /* Caps Lock is worth reporting on a field whose contents cannot be read
     back. Both key events are watched: keydown catches the state while a key
     is held, keyup catches the release of Caps Lock itself. */
  function trackCaps(e: KeyboardEvent<HTMLInputElement>) {
    setCaps(e.getModifierState('CapsLock'))
  }

  /* The fields sit on the card's inset wash with no hairline, and take the
     navy ring on focus. A field with an error keeps Field's own red border -
     that edge is the message. */
  const fieldClass = (bad: boolean) =>
    cx(
      'h-11 rounded-[12px] text-[13.5px]',
      !bad &&
        'border-transparent bg-wash hover:border-transparent focus:border-navy-600 focus:bg-white',
    )

  return (
    <div className="grid h-full place-items-center overflow-auto bg-ground px-4 py-8">
      <div className="w-full max-w-[380px]">
        <section className="panel px-7 pt-8 pb-7">
          <div className="flex flex-col items-center text-center">
            <AppLogo size={48} />
            <h1 className="mt-4 font-display text-[22px] leading-none font-bold tracking-[-0.02em] text-navy-900">
              Sign in to CHAS
            </h1>
            <p className="mt-2 text-[12.5px] text-muted">Child Health Assessment System</p>
          </div>

          {mustChange ? (
            <SetNewPassword
              currentPassword={password}
              onDone={() => enter(mustChange)}
              onCancel={() => {
                void endpoints.signOut().catch(() => {})
                setMustChange(null)
                setPassword('')
              }}
            />
          ) : forgot ? (
            <ForgotPassword
              initialUsername={username.trim()}
              onCancel={() => setForgot(false)}
              onDone={(name, message) => {
                setUsername(name)
                setPassword('')
                setFormError(null)
                setNotice(message)
                setForgot(false)
              }}
            />
          ) : (
          <form className="mt-7 space-y-4" onSubmit={submit} noValidate>
            {notice && (
              <p
                role="status"
                className="flex items-start gap-2 rounded-[10px] bg-[#f2faf5] px-3 py-2.5 text-[12px] leading-relaxed font-medium text-[#14663a]"
              >
                <CheckCircle size={15} weight="fill" className="mt-px shrink-0" />
                {notice}
              </p>
            )}

            {/* Whose laptop this is - the LOCAL build's question only. On the
                server build the account holds the records, the answer arrives
                with the sign-in response, and a role picker here would be a
                control that either does nothing or contradicts the server. */}
            {!SERVER_BACKED && install && !reclaiming && (
              <div className="rounded-[12px] bg-wash px-3 py-2.5">
                <div className="flex items-center gap-2.5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white text-navy-700">
                    {admin ? (
                      <Buildings size={15} weight="fill" />
                    ) : (
                      <FirstAidKit size={15} weight="fill" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-semibold text-navy-900">
                      {install.adviser}
                    </div>
                    <div className="truncate text-[11px] text-muted">
                      {admin ? ADMIN.title : NURSE.title} · all sections
                    </div>
                  </div>

                  {/* Quiet on purpose: reassigning a laptop happens once a
                      year, so it is a link, not a button beside Sign in. */}
                  {reclaim === 'no' && (
                    <button
                      type="button"
                      onClick={() => setReclaim('confirm')}
                      className="shrink-0 rounded-full px-2 py-1 text-[11.5px] font-medium text-navy-700 transition-colors duration-100 hover:bg-white hover:text-navy-900"
                    >
                      Change
                    </button>
                  )}
                </div>

                {/* The confirm names whose laptop is being given up, because
                    "are you sure" without the thing at stake in it is a dialog
                    people learn to click through. It also says what does NOT
                    happen: what is already recorded stays. */}
                {reclaim === 'confirm' && (
                  <div className="mt-2.5 rounded-[10px] bg-gold-100 px-3 py-2.5">
                    <p className="flex items-start gap-2 text-[11.5px] leading-relaxed text-gold-700">
                      <Warning size={14} weight="fill" className="mt-px shrink-0" />
                      <span>
                        This laptop is currently{' '}
                        <span className="font-semibold">{install.adviser}</span>&apos;s.
                        Changing it signs the machine in as somebody else. Everything already
                        recorded here stays on this computer.
                      </span>
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          /* Start the chooser from what the machine is now, so
                             the first thing shown is the truth and any change
                             to it is a deliberate move away. */
                          setRole(install.role)
                          setReclaim('open')
                        }}
                        className="rounded-full bg-navy-900 px-3 py-1.5 text-[11.5px] font-medium text-white transition-colors duration-100 hover:bg-navy-800"
                      >
                        Change what this laptop keeps
                      </button>
                      <button
                        type="button"
                        onClick={() => setReclaim('no')}
                        className="rounded-full px-3 py-1.5 text-[11.5px] font-medium text-gold-700 transition-colors duration-100 hover:bg-white/60"
                      >
                        Keep it as it is
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Two radios wearing a segmented pill: two choices, both
                visible, one tab stop. */}
            {!SERVER_BACKED && (!install || reclaiming) && (
              <fieldset>
                <legend className="mb-1 text-[11.5px] font-medium text-muted">
                  This laptop is for
                </legend>
                <div className="grid grid-cols-2 gap-1 rounded-full bg-wash p-1">
                  <RoleOption
                    icon={<Buildings size={14} weight="fill" />}
                    title="School Head"
                    checked={admin}
                    onSelect={() => setRole('admin')}
                  />
                  <RoleOption
                    icon={<FirstAidKit size={14} weight="fill" />}
                    title="School Nurse"
                    checked={!admin}
                    onSelect={() => setRole('nurse')}
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-muted">
                  Signs in as{' '}
                  <span className="font-medium text-navy-900">
                    {admin ? ADMIN.name : NURSE.name}
                  </span>
                  {install ? '. Choose who keeps it from here.' : '. Set once.'}
                </p>
              </fieldset>
            )}

            <Field
              ref={userRef}
              label="Username"
              placeholder={usernameHint}
              autoComplete="username"
              autoFocus
              spellCheck={false}
              value={username}
              error={errors.username}
              leading={<User size={16} />}
              inputClassName={fieldClass(Boolean(errors.username))}
              onChange={(e) => {
                setUsername(e.target.value)
                if (errors.username) setErrors((p) => ({ ...p, username: undefined }))
              }}
            />

            <div>
              <Field
                label="Password"
                type={reveal ? 'text' : 'password'}
                placeholder="Enter your password"
                autoComplete="current-password"
                value={password}
                error={errors.password}
                leading={<LockKey size={16} weight="fill" />}
                inputClassName={cx(fieldClass(Boolean(errors.password)), 'pr-11')}
                onChange={(e) => {
                  setPassword(e.target.value)
                  if (errors.password) setErrors((p) => ({ ...p, password: undefined }))
                }}
                onKeyDown={trackCaps}
                onKeyUp={trackCaps}
                onBlur={() => setCaps(false)}
                trailing={
                  /* A long password typed blind on a shared machine is the
                     commonest reason a sign-in fails twice in a row. */
                  <button
                    type="button"
                    onClick={() => setReveal((v) => !v)}
                    aria-label={reveal ? 'Hide password' : 'Show password'}
                    aria-pressed={reveal}
                    className={cx(
                      'mr-0.5 grid size-8 place-items-center rounded-full text-muted',
                      'transition-colors duration-100 hover:bg-navy-50 hover:text-navy-800',
                    )}
                  >
                    {reveal ? <EyeSlash size={16} /> : <Eye size={16} />}
                  </button>
                }
              />

              {/* Caps Lock, under the field whose contents cannot be read back. */}
              <div className="mt-1.5 flex min-h-5 items-center gap-3">
                {caps ? (
                  <p
                    role="status"
                    className="flex items-center gap-1.5 text-[11px] font-medium text-gold-700"
                  >
                    <Warning size={12} weight="fill" className="shrink-0" />
                    Caps Lock is on
                  </p>
                ) : (
                  <span />
                )}
                {SERVER_BACKED && (
                  <button
                    type="button"
                    onClick={() => {
                      setFormError(null)
                      setNotice(null)
                      setForgot(true)
                    }}
                    className="ml-auto rounded-full px-2 py-0.5 text-[11.5px] font-medium text-navy-700 transition-colors duration-100 hover:bg-wash hover:text-navy-900"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
            </div>

            {/* role="alert" so a screen reader announces it without the user
                having to go looking for what happened. */}
            {formError && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-[10px] bg-[#fdf2f5] px-3 py-2.5 text-[12px] leading-relaxed font-medium text-[#9f1239]"
              >
                <Warning size={15} weight="fill" className="mt-px shrink-0" />
                {formError}
              </p>
            )}

            {/* The screen's one yellow action, as on every dashboard. The
                only wait it reports is real - the record file coming back
                from disk, or Argon2 on the server. */}
            <AccentButton
              type="submit"
              disabled={!ready || pending}
              className="!mt-5 h-11 w-full rounded-full text-[14px]"
            >
              {pending ? 'Checking…' : ready ? 'Sign in' : 'Signing in…'}
              {ready && !pending && <ArrowRight size={16} weight="bold" />}
            </AccentButton>
          </form>
          )}
        </section>

        {/* Which school's records are behind this door. */}
        <p className="mt-5 text-center text-[11.5px] leading-relaxed text-muted">
          <span className="font-medium text-navy-900">{school.name}</span>
          <br />
          {school.district}, {school.division} · S.Y. {schoolYear}
        </p>
      </div>
    </div>
  )
}
