import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import {
  Buildings,
  FirstAidKit,
  ShieldCheck,
  Prohibit,
  UserPlus,
  CheckCircle,
  Key,
  Warning,
  LockKey,
  Trash,
  MagnifyingGlass,
  X,
  CaretUp,
  CaretDown,
  IdentificationBadge,
  PencilSimple,
} from '@phosphor-icons/react'
import { Button, Empty, Field, PILL, PILL_OFF, PILL_ON, cx } from '@/components/ui'
import {
  ConfirmDialog,
  Modal,
  ModalCloseButton,
  ModalContent,
  ModalDescription,
  ModalTitle,
  Select,
} from '@/components/primitives'
import { Y } from '@/components/bento'
import { Navigate } from 'react-router-dom'
import { useQuery } from '@/lib/query'
import { ApiError, endpoints, type ApiRole, type ApiStaff } from '@/lib/api'
import { isAdmin, useRoster } from '@/lib/records'

/* Staff accounts, on the server build.

   The other Roles screen - screens/Roles.tsx - edits a list in a JSON file on
   one laptop. This one creates and revokes accounts that can actually sign
   in, which is a different thing wearing the same word, so it is a different
   file rather than a branch inside that one. Nothing here is derived from
   data/mock.ts: the school's staff is whoever the head has created.

   THE SHAPE follows the Learners table (2026-10-14): one toolbar panel with
   status tabs, a search and the yellow "Add account" button, then the table,
   with the row actions as small icon buttons on the right. Adding an
   account and setting a password each open a modal rather than a panel or
   an inline row editor.

   THE PASSWORD IS SHOWN ONCE. The head types the first password and reads it
   to the new account holder. It is displayed after the account is made and
   then it is gone - not stored in this component, not persisted, and never
   returned by any later request, because the server only ever holds the
   Argon2 hash.

   EVERY RULE IS ALSO A SERVER RULE. The last active head cannot be revoked
   or deleted, nobody deletes their own account, and a username cannot be
   taken twice. Those are enforced in server/src/routes/users.ts; what this
   screen does is refuse to offer the control and say why, so the person
   finds out before the request rather than from a red banner after it.

   TWO ROLES, BOTH SCHOOL-WIDE. A head and a nurse both read every section.
   What separates them is not scope but power: everything on THIS screen is
   the head's, and a nurse who signs in cannot open it at all. There is no
   class-adviser account.

   FORGOTTEN PASSWORDS. Each person signs back in with one of their own
   printed recovery codes (My account). Without one, the head sets a new
   password here with the key button. */

type Note = { tone: 'ok' | 'warn'; text: string }

const ROLE_LABEL: Record<ApiRole, string> = {
  ADMIN: 'School head',
  NURSE: 'School nurse',
}

const ROLE_OPTIONS = [
  { value: 'ADMIN', label: ROLE_LABEL.ADMIN },
  { value: 'NURSE', label: ROLE_LABEL.NURSE },
]

/** What the account will actually see, in the words the scope has. */
function scopeOf(role: ApiRole): string {
  return role === 'NURSE' ? 'All sections, health records' : 'All sections, full access'
}

function when(iso: string | null): string {
  if (!iso) return 'Never'
  const d = new Date(iso)
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

/** "Mrs. M. Ocampo" -> "MO", for the avatar circle. */
function initialsOf(fullName: string): string {
  const parts = fullName
    .replace(/^(Mrs|Mr|Ms|Dr|Gng|Bb|G)\.?\s+/i, '')
    .split(/\s+/)
    .filter((w) => w && !/^(Jr|Sr)\.?$|^(II|III|IV)$/i.test(w))
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : ''
  return (first + last).toUpperCase()
}


/* The head's screen. The nurse's sidebar does not offer it, but the route
   exists, and opening it by address used to load the page and then fail on
   the server's 403. Redirected before anything is fetched, the same way
   Backup and School year are. */
export default function ServerRoles() {
  const { install, ready } = useRoster()
  if (!ready) return null
  if (!isAdmin(install)) return <Navigate to="/admin" replace />
  return <Accounts />
}

type StatusTab = 'all' | 'active' | 'off'
type SortKey = 'name' | 'role' | 'signedIn'

function Accounts() {
  const [staff, setStaff] = useState<ApiStaff[] | null>(null)
  const [note, setNote] = useState<Note | null>(null)
  const [busy, setBusy] = useState(false)

  const [status, setStatus] = useState<StatusTab>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'role', dir: 1 })

  /* Shown once, after a create or a reset. Held in state only until the head
     dismisses it or does something else. */
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null)

  const [adding, setAdding] = useState(false)
  const [settingPassword, setSettingPassword] = useState<ApiStaff | null>(null)
  const [editing, setEditing] = useState<ApiStaff | null>(null)
  const [deleting, setDeleting] = useState<ApiStaff | null>(null)
  /* Switching an account off locks that person out at once, so it asks
     first (2026-10-13). Switching it back on does not need to. */
  const [switchingOff, setSwitchingOff] = useState<ApiStaff | null>(null)

  /* Who is signed in, so their own row offers no Delete. */
  const me = useQuery('me', endpoints.me).data?.user.id

  const load = useCallback(async () => {
    try {
      const u = await endpoints.staff()
      setStaff(u.users)
    } catch (err) {
      setStaff([])
      setNote({
        tone: 'warn',
        text: err instanceof ApiError ? err.message : 'Unable to load accounts.',
      })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const all = staff ?? []
  const heads = useMemo(() => all.filter((u) => u.role === 'ADMIN' && !u.disabledAt).length, [all])

  /** One place for "the request failed", so every control reports the
      server's own sentence rather than a generic one. */
  async function run(fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      setNote({
        tone: 'warn',
        text: err instanceof ApiError ? err.message : 'Something went wrong. Try again.',
      })
    } finally {
      setBusy(false)
    }
  }

  function setAccess(u: ApiStaff, off: boolean) {
    void run(async () => {
      await endpoints.updateStaff(u.id, { disabled: off })
      setNote({
        tone: 'ok',
        text: off ? `${u.fullName} can no longer sign in.` : `${u.fullName} can sign in again.`,
      })
      await load()
    })
  }

  const counts = {
    all: all.length,
    active: all.filter((u) => !u.disabledAt).length,
    off: all.filter((u) => u.disabledAt).length,
  }
  const tabs: { value: StatusTab; label: string; n: number }[] = [
    { value: 'all', label: 'All', n: counts.all },
    { value: 'active', label: 'Active', n: counts.active },
    { value: 'off', label: 'Switched off', n: counts.off },
  ]

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = all.filter((u) => {
      if (status === 'active' && u.disabledAt) return false
      if (status === 'off' && !u.disabledAt) return false
      if (!q) return true
      return [u.fullName, u.username].some((s) => s.toLowerCase().includes(q))
    })
    const byName = (a: ApiStaff, b: ApiStaff) => a.fullName.localeCompare(b.fullName)
    return list.sort((a, b) => {
      let d = 0
      if (sort.key === 'role') d = a.role.localeCompare(b.role)
      if (sort.key === 'signedIn') d = (a.lastLoginAt ?? '').localeCompare(b.lastLoginAt ?? '')
      return d * sort.dir || byName(a, b) * (sort.key === 'name' ? sort.dir : 1)
    })
  }, [all, status, search, sort])

  function onSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }))
  }

  const narrowed = status !== 'all' || search.trim() !== ''

  return (
    <div className="h-full overflow-auto px-6 pt-1 pb-6">
      {note && (
        <div
          className={cx(
            'mb-3 flex items-start gap-2.5 rounded-[14px] px-4 py-2.5 text-[11.5px] leading-relaxed',
            note.tone === 'ok' ? 'bg-[#f2faf5] text-[#14663a]' : 'bg-gold-100 text-gold-700',
          )}
        >
          {note.tone === 'ok' ? (
            <CheckCircle size={15} weight="fill" className="mt-px shrink-0" />
          ) : (
            <Warning size={15} weight="fill" className="mt-px shrink-0" />
          )}
          <span className="flex-1">{note.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNote(null)} className="shrink-0 opacity-70 hover:opacity-100">
            <X size={12} weight="bold" />
          </button>
        </div>
      )}

      {/* The password, once. Gold rather than green: this is not a "done"
          message, it is the only moment this string exists anywhere a person
          can read it. */}
      {issued && (
        <div className="mb-3 rounded-[14px] bg-gold-100 px-4 py-3">
          <div className="flex items-start gap-2.5">
            <Key size={16} weight="fill" className="mt-px shrink-0 text-gold-700" />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold text-gold-700">
                Record this password now. It will not be shown again.
              </p>
              <p className="mt-0.5 text-[11.5px] text-gold-700">
                A new password is required at the first sign-in.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1.5">
                <span className="text-[12px] text-gold-700">
                  Username{' '}
                  <span className="font-mono text-[13px] font-semibold text-navy-900">{issued.username}</span>
                </span>
                <span className="text-[12px] text-gold-700">
                  Password{' '}
                  <span className="font-mono text-[13px] font-semibold text-navy-900">{issued.password}</span>
                </span>
              </div>
            </div>
            <Button variant="ghost" onClick={() => setIssued(null)}>
              Done
            </Button>
          </div>
        </div>
      )}

      {/* --- Toolbar: status, search, add ------------------------------------ */}
      <div className="panel flex flex-wrap items-center justify-between gap-2 rounded-[16px] py-2 pr-2 pl-2.5">
        <div role="tablist" aria-label="Status" className="flex flex-wrap gap-1">
          {tabs.map((t) => {
            const on = status === t.value
            return (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setStatus(t.value)}
                className={cx(PILL, 'h-[34px] px-4 text-[12.5px]', on ? PILL_ON : PILL_OFF)}
              >
                {t.label}
                <span className="tnum opacity-70">{t.n}</span>
              </button>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="relative block w-[240px]">
            <MagnifyingGlass
              size={14}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-placeholder"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or username"
              aria-label="Search by name or username"
              className="h-9 w-full rounded-[10px] bg-wash pr-8 pl-9 text-[12.5px] text-ink placeholder:text-placeholder focus:bg-white focus:shadow-[inset_0_0_0_1px_var(--color-navy-600),0_0_0_3px_rgba(43,82,196,0.14)] focus:outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute top-1/2 right-2 grid size-5 -translate-y-1/2 place-items-center rounded-full text-placeholder hover:bg-navy-50 hover:text-navy-900"
              >
                <X size={11} weight="bold" />
              </button>
            )}
          </label>

          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex h-9 items-center gap-2 rounded-[10px] px-4 text-[12.5px] font-semibold text-[#071539] transition-[filter] duration-100 hover:brightness-95 active:translate-y-px"
            style={{ background: Y }}
          >
            <UserPlus size={15} weight="bold" />
            Add account
          </button>
        </div>
      </div>

      {/* --- The table -------------------------------------------------------- */}
      {staff !== null && rows.length === 0 ? (
        <div className="panel mt-3 pt-6 pb-10">
          <Empty
            icon={<IdentificationBadge size={32} />}
            title={narrowed ? 'No accounts match' : 'No accounts'}
            body={narrowed ? 'Try another search or filter.' : 'Add an account to begin.'}
          />
          {narrowed && (
            <div className="mt-3 flex justify-center">
              <Button
                onClick={() => {
                  setStatus('all')
                  setSearch('')
                }}
              >
                Clear filters
              </Button>
            </div>
          )}
        </div>
      ) : (
        <AccountTable
          rows={rows}
          sort={sort}
          onSort={onSort}
          me={me}
          heads={heads}
          busy={busy}
          onEdit={setEditing}
          onPassword={setSettingPassword}
          onAccess={(u) => (u.disabledAt ? setAccess(u, false) : setSwitchingOff(u))}
          onDelete={setDeleting}
        />
      )}

      {/* --- Modals ----------------------------------------------------------- */}
      <AddAccountModal
        open={adding}
        onOpenChange={setAdding}
        onCreated={async (username, password) => {
          setAdding(false)
          setIssued({ username, password })
          setNote(null)
          await load()
        }}
      />

      <EditAccountModal
        key={editing?.id ?? 'none'}
        user={editing}
        me={me}
        heads={heads}
        onClose={() => setEditing(null)}
        onSaved={async (before, after) => {
          setEditing(null)
          setNote({
            tone: 'ok',
            text:
              before.username === after.username
                ? `${after.fullName}'s account was updated.`
                : after.id === me
                  ? `Your account was updated. Sign in with the username ${after.username} from now on.`
                  : `${after.fullName}'s account was updated. They sign in with the username ${after.username} from now on.`,
          })
          await load()
        }}
      />

      <PasswordModal
        user={settingPassword}
        onClose={() => setSettingPassword(null)}
        onSaved={async (u, password) => {
          setSettingPassword(null)
          setIssued({ username: u.username, password })
          await load()
        }}
      />

      <ConfirmDialog
        open={switchingOff !== null}
        onOpenChange={(o) => !o && setSwitchingOff(null)}
        title={`Switch off ${switchingOff?.fullName ?? ''}'s account?`}
        body={
          <>
            <span className="font-mono text-navy-900">{switchingOff?.username}</span> will not be able to
            sign in until the account is switched on again. Their records are kept.
          </>
        }
        confirmLabel="Switch off"
        tone="danger"
        busy={busy}
        onConfirm={() => {
          const u = switchingOff
          setSwitchingOff(null)
          if (u) setAccess(u, true)
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.fullName ?? ''}'s account?`}
        body={
          <>
            <span className="font-mono text-navy-900">{deleting?.username}</span> can no longer sign in
            and will be removed from this list. This cannot be undone. Records created by this account
            are kept under {deleting?.fullName}. The username will become available.
          </>
        }
        confirmLabel="Delete account"
        tone="danger"
        busy={busy}
        onConfirm={() => {
          const u = deleting
          if (!u) return
          setDeleting(null)
          void run(async () => {
            await endpoints.deleteStaff(u.id)
            setNote({ tone: 'ok', text: `${u.fullName}'s account was deleted.` })
            await load()
          })
        }}
      />
    </div>
  )
}

/* --- The table, in the Learners table's shape --------------------------- */

const COLUMNS: { label: string; sort?: SortKey; className?: string }[] = [
  { label: 'Name', sort: 'name', className: 'pl-4' },
  { label: 'Role', sort: 'role' },
  { label: 'Last signed in', sort: 'signedIn' },
  { label: 'Status' },
  { label: '', className: 'pr-4' },
]

function AccountTable({
  rows,
  sort,
  onSort,
  me,
  heads,
  busy,
  onEdit,
  onPassword,
  onAccess,
  onDelete,
}: {
  rows: ApiStaff[]
  sort: { key: SortKey; dir: 1 | -1 }
  onSort: (key: SortKey) => void
  me: string | undefined
  heads: number
  busy: boolean
  onEdit: (u: ApiStaff) => void
  onPassword: (u: ApiStaff) => void
  onAccess: (u: ApiStaff) => void
  onDelete: (u: ApiStaff) => void
}) {
  return (
    <div className="panel mt-3 overflow-x-auto rounded-[18px] p-0">
      <table className="w-full min-w-[700px] border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-line-soft">
            {COLUMNS.map((c) => {
              const active = c.sort && sort.key === c.sort
              return (
                <th
                  key={c.label || 'actions'}
                  scope="col"
                  aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
                  className={cx(
                    'px-2 py-3 text-left text-[10.5px] font-semibold tracking-[0.05em] whitespace-nowrap text-placeholder uppercase',
                    c.className,
                  )}
                >
                  {c.sort ? (
                    <button
                      type="button"
                      onClick={() => onSort(c.sort!)}
                      className={cx(
                        'inline-flex items-center gap-1 uppercase transition-colors duration-100 hover:text-navy-900',
                        active && 'text-navy-900',
                      )}
                    >
                      {c.label}
                      {active ? (
                        sort.dir === 1 ? <CaretUp size={10} weight="bold" /> : <CaretDown size={10} weight="bold" />
                      ) : (
                        <CaretDown size={10} weight="bold" className="opacity-30" />
                      )}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody className="tnum">
          {rows.map((u) => {
            const off = u.disabledAt !== null
            /* The rule the server will enforce anyway, applied here so the
               control is not offered in the first place. */
            const lastHead = u.role === 'ADMIN' && !off && heads <= 1
            return (
              <tr
                key={u.id}
                className="border-b border-line-soft transition-colors duration-100 last:border-b-0 hover:bg-wash"
              >
                <td className="py-2 pr-2 pl-4">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={cx(
                        'grid size-8 shrink-0 place-items-center rounded-full text-[10.5px] font-bold',
                        off ? 'bg-wash text-placeholder' : 'bg-navy-50 text-navy-700',
                      )}
                    >
                      {initialsOf(u.fullName)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold whitespace-nowrap text-navy-900">
                        {u.fullName}
                        {u.id === me && <span className="ml-1.5 text-[10.5px] font-medium text-muted">(you)</span>}
                      </span>
                      <span className="block font-mono text-[10.5px] text-muted">{u.username}</span>
                    </span>
                  </span>
                </td>
                <td className="px-2 py-2 whitespace-nowrap">
                  <span title={scopeOf(u.role)} className="inline-flex items-center gap-1 rounded-full bg-navy-50 px-2 py-0.5 text-[10.5px] font-semibold text-navy-700">
                    {u.role === 'ADMIN' ? <Buildings size={11} weight="fill" /> : <FirstAidKit size={11} weight="fill" />}
                    {ROLE_LABEL[u.role]}
                  </span>
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-navy-900">{when(u.lastLoginAt)}</td>
                <td className="px-2 py-2 whitespace-nowrap">
                  {off ? (
                    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-muted">
                      <span className="size-1.5 rounded-full bg-placeholder" />
                      Switched off
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-[#14663a]">
                      <span className="size-1.5 rounded-full bg-[#22a35a]" />
                      Active
                    </span>
                  )}
                </td>
                <td className="py-2 pr-4 pl-2">
                  <span className="flex justify-end gap-1">
                    <IconAction label="Edit account" disabled={busy} onClick={() => onEdit(u)}>
                      <PencilSimple size={14} weight="bold" />
                    </IconAction>
                    <IconAction label="Set password" disabled={busy} onClick={() => onPassword(u)} primary>
                      <Key size={14} weight="bold" />
                    </IconAction>
                    <IconAction
                      label={
                        lastHead
                          ? 'At least one active school head account is required.'
                          : off
                            ? 'Switch on'
                            : 'Switch off'
                      }
                      disabled={busy || lastHead}
                      onClick={() => onAccess(u)}
                    >
                      {off ? <ShieldCheck size={14} weight="bold" /> : <Prohibit size={14} weight="bold" />}
                    </IconAction>
                    <IconAction
                      label={
                        u.id === me
                          ? 'You cannot delete your own account.'
                          : lastHead
                            ? 'At least one active school head account is required.'
                            : 'Delete account'
                      }
                      disabled={busy || lastHead || u.id === me}
                      onClick={() => onDelete(u)}
                      danger
                    >
                      <Trash size={14} weight="bold" />
                    </IconAction>
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function IconAction({
  label,
  onClick,
  children,
  primary,
  danger,
  disabled,
}: {
  label: string
  onClick: () => void
  children: ReactNode
  primary?: boolean
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cx(
        'grid size-[30px] place-items-center rounded-[9px] transition-colors duration-100',
        'disabled:cursor-not-allowed disabled:opacity-35',
        primary
          ? 'bg-navy-900 text-white enabled:hover:bg-navy-800'
          : danger
            ? 'bg-wash text-[#a4262c] enabled:hover:bg-[#fdf2f5]'
            : 'bg-wash text-navy-700 enabled:hover:bg-navy-50',
      )}
    >
      {children}
    </button>
  )
}

/* --- Modals -------------------------------------------------------------- */

/** Header, body and footer, the same in every modal on this screen. */
function FormModal({
  open,
  onOpenChange,
  title,
  description,
  error,
  submitLabel,
  busy,
  onSubmit,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  error: string | null
  submitLabel: string
  busy: boolean
  onSubmit: () => void
  children: ReactNode
}) {
  function submit(e: FormEvent) {
    e.preventDefault()
    onSubmit()
  }
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="max-w-[520px]">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-col">
          <div className="flex items-start justify-between gap-3 px-6 pt-6">
            <div>
              <div className="h-1 w-9 rounded-full bg-seal-yellow" />
              <ModalTitle className="mt-3.5 font-display text-[19px] leading-none font-bold tracking-[-0.02em] text-navy-900">
                {title}
              </ModalTitle>
              <ModalDescription className="mt-2 text-[12px] leading-relaxed text-muted">
                {description}
              </ModalDescription>
            </div>
            <ModalCloseButton />
          </div>

          <div className="min-h-0 space-y-4 overflow-y-auto px-6 pt-5 pb-1">
            {children}
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

          <div className="flex justify-end gap-2 px-6 pt-4 pb-6">
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
              {busy ? 'Saving…' : submitLabel}
            </button>
          </div>
        </form>
      </ModalContent>
    </Modal>
  )
}

const MODAL_FIELD = 'h-11 rounded-[12px] text-[13.5px]'

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/* The name in parts (2026-10-14: the head asked for separate first, middle
   and last name fields instead of one "full name" box, and no title or
   suffix). The account still keeps one display name, built here: "Maria C.
   Delos Reyes" - first name, middle initial, last name. The Username field
   fills itself from the parts, first initial and last name, and the head
   can type over it. */

interface NameParts {
  first: string
  middle: string
  last: string
}

const BLANK_NAME: NameParts = { first: '', middle: '', last: '' }

function displayName(n: NameParts): string {
  const middle = n.middle.trim() ? `${n.middle.trim()[0].toUpperCase()}.` : ''
  return [n.first.trim(), middle, n.last.trim()].filter(Boolean).join(' ')
}

/** "Maria", "Delos Reyes" -> "m.delosreyes". Accents dropped: "Peña" -> "pena". */
function usernameFrom(first: string, last: string): string {
  const plain = (x: string) =>
    x
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
  const f = plain(first)[0] ?? ''
  const l = plain(last)
  return f && l ? `${f}.${l}` : ''
}

/** A Select dressed as a form field, to sit in a row with the text fields. */
const SELECT_FIELD =
  'h-11 w-full justify-between rounded-[12px] border border-line bg-white px-3.5 text-[13.5px] font-normal hover:bg-white data-[state=open]:bg-white'

function AddAccountModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (username: string, password: string) => Promise<void>
}) {
  const [name, setName] = useState<NameParts>(BLANK_NAME)
  /* null until the head types in the Username field. Until then it follows
     the name (first initial and last name); after that it is theirs. */
  const [usernameTyped, setUsernameTyped] = useState<string | null>(null)
  const [role, setRole] = useState<ApiRole>('NURSE')
  const [pass, setPass] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /* A fresh form every time it opens. */
  useEffect(() => {
    if (!open) return
    setName(BLANK_NAME)
    setUsernameTyped(null)
    setRole('NURSE')
    setPass('')
    setError(null)
  }, [open])

  const set = (k: keyof NameParts) => (v: string) => {
    setName((n) => ({ ...n, [k]: v }))
    setError(null)
  }

  const username = usernameTyped ?? usernameFrom(name.first, name.last)

  async function create() {
    if (!name.first.trim()) return setError('Enter the first name.')
    if (!name.last.trim()) return setError('Enter the last name.')
    if (username.length < 3) return setError('The username needs at least three characters.')
    /* The server's rule (routes/users.ts), checked here so the head hears
       it before the request. */
    if (!/^[a-z0-9._-]+$/.test(username))
      return setError('Usernames are lowercase letters, digits, dots, dashes and underscores.')
    if (pass.length < 12) return setError('The password needs at least twelve characters.')
    setError(null)
    setBusy(true)
    try {
      const { user } = await endpoints.createStaff({
        fullName: displayName(name),
        username,
        password: pass,
        role,
      })
      await onCreated(user.username, pass)
    } catch (err) {
      setError(message(err, 'The account could not be created.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormModal
      open={open}
      onOpenChange={onOpenChange}
      title="Add an account"
      description="Creates a sign-in for a staff member."
      error={error}
      submitLabel="Create account"
      busy={busy}
      onSubmit={() => void create()}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="First name"
          placeholder="Maria"
          autoFocus
          value={name.first}
          inputClassName={MODAL_FIELD}
          onChange={(e) => set('first')(e.target.value)}
        />
        <Field
          label="Middle name (optional)"
          placeholder="Cruz"
          value={name.middle}
          inputClassName={MODAL_FIELD}
          onChange={(e) => set('middle')(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 items-end gap-3">
        <Field
          label="Last name"
          placeholder="Delos Reyes"
          value={name.last}
          inputClassName={MODAL_FIELD}
          onChange={(e) => set('last')(e.target.value)}
        />
        <Field
          label="Username"
          placeholder="m.delosreyes"
          autoComplete="off"
          spellCheck={false}
          maxLength={32}
          value={username}
          inputClassName={cx(MODAL_FIELD, 'font-mono')}
          onChange={(e) => {
            setUsernameTyped(e.target.value.toLowerCase().replace(/\s+/g, ''))
            setError(null)
          }}
        />
      </div>

      <div>
        <span className="mb-1 block text-[11.5px] font-medium text-muted">Role</span>
        <Select
          label="Role for the new account"
          value={role}
          options={ROLE_OPTIONS}
          onValueChange={(v) => setRole(v as ApiRole)}
          className={SELECT_FIELD}
        />
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
          {role === 'ADMIN'
            ? 'Full access to all sections, reports and account management.'
            : 'All sections for measurements, slips, health records and the SF8. Cannot manage accounts or backups.'}
        </p>
      </div>

      <Field
        label="First password"
        placeholder="At least twelve characters"
        autoComplete="off"
        value={pass}
        leading={<LockKey size={16} weight="fill" />}
        inputClassName={MODAL_FIELD}
        onChange={(e) => setPass(e.target.value)}
        hint="Give this password to the staff member. It will not be shown again."
      />
    </FormModal>
  )
}

/* Editing an account (2026-10-19, the user's request): the name, the
   username and the role. The name is the one display name the account
   keeps, so it is one field here rather than the parts the Add form asks
   for. A new username keeps the account's sessions and records; only the
   next sign-in needs it, which the note after saving says. */
function EditAccountModal({
  user,
  me,
  heads,
  onClose,
  onSaved,
}: {
  user: ApiStaff | null
  me: string | undefined
  heads: number
  onClose: () => void
  onSaved: (before: ApiStaff, after: ApiStaff) => Promise<void>
}) {
  /* Started from the account itself; the screen keys this modal by the
     account, so each one opens with its own values and no blank frame. */
  const [fullName, setFullName] = useState(user?.fullName ?? '')
  const [username, setUsername] = useState(user?.username ?? '')
  const [role, setRole] = useState<ApiRole>(user?.role ?? 'NURSE')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /* The server refuses to demote the last active head; the control is not
     offered instead. */
  const lastHead = user?.role === 'ADMIN' && !user.disabledAt && heads <= 1

  async function save() {
    if (!user) return
    const name = fullName.trim()
    if (name.length < 2) return setError('Enter the name.')
    if (username.length < 3) return setError('The username needs at least three characters.')
    if (!/^[a-z0-9._-]+$/.test(username))
      return setError('Usernames are lowercase letters, digits, dots, dashes and underscores.')
    const body = {
      ...(name !== user.fullName && { fullName: name }),
      ...(username !== user.username && { username }),
      ...(role !== user.role && { role }),
    }
    if (Object.keys(body).length === 0) return onClose()
    setError(null)
    setBusy(true)
    try {
      const { user: saved } = await endpoints.updateStaff(user.id, body)
      await onSaved(user, saved)
    } catch (err) {
      setError(message(err, 'The account could not be saved.'))
    } finally {
      setBusy(false)
    }
  }

  const renamed = user !== null && username !== user.username

  return (
    <FormModal
      open={user !== null}
      onOpenChange={(o) => !o && onClose()}
      title="Edit account"
      description={user?.id === me ? 'Your own account.' : `For ${user?.fullName ?? ''}.`}
      error={error}
      submitLabel="Save changes"
      busy={busy}
      onSubmit={() => void save()}
    >
      <Field
        label="Name"
        placeholder="Maria C. Delos Reyes"
        autoFocus
        value={fullName}
        inputClassName={MODAL_FIELD}
        onChange={(e) => {
          setFullName(e.target.value)
          setError(null)
        }}
      />

      <Field
        label="Username"
        placeholder="m.delosreyes"
        autoComplete="off"
        spellCheck={false}
        maxLength={32}
        value={username}
        inputClassName={cx(MODAL_FIELD, 'font-mono')}
        onChange={(e) => {
          setUsername(e.target.value.toLowerCase().replace(/\s+/g, ''))
          setError(null)
        }}
        hint={
          renamed
            ? 'The new username is needed at the next sign-in. Records and sessions are kept.'
            : 'Lowercase letters, digits, dots, dashes and underscores.'
        }
      />

      <div>
        <span className="mb-1 block text-[11.5px] font-medium text-muted">Role</span>
        <Select
          label="Role for this account"
          value={role}
          options={ROLE_OPTIONS}
          onValueChange={(v) => setRole(v as ApiRole)}
          disabled={lastHead}
          className={SELECT_FIELD}
        />
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
          {lastHead
            ? 'At least one active school head account is required.'
            : role === 'ADMIN'
              ? 'Full access to all sections, reports and account management.'
              : 'All sections for measurements, slips, health records and the SF8. Cannot manage accounts or backups.'}
        </p>
      </div>
    </FormModal>
  )
}

function PasswordModal({
  user,
  onClose,
  onSaved,
}: {
  user: ApiStaff | null
  onClose: () => void
  onSaved: (u: ApiStaff, password: string) => Promise<void>
}) {
  const [pass, setPass] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setPass('')
    setError(null)
  }, [user])

  async function save() {
    if (!user) return
    if (pass.length < 12) return setError('The password needs at least twelve characters.')
    setBusy(true)
    try {
      await endpoints.resetStaffPassword(user.id, pass)
      await onSaved(user, pass)
    } catch (err) {
      setError(message(err, 'The password could not be saved.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormModal
      open={user !== null}
      onOpenChange={(o) => !o && onClose()}
      title="Set a new password"
      description={`For ${user?.fullName ?? ''} (${user?.username ?? ''}). They will be signed out everywhere.`}
      error={error}
      submitLabel="Save password"
      busy={busy}
      onSubmit={() => void save()}
    >
      <Field
        label="New password"
        placeholder="At least twelve characters"
        autoComplete="off"
        autoFocus
        value={pass}
        leading={<LockKey size={16} weight="fill" />}
        inputClassName={MODAL_FIELD}
        onChange={(e) => setPass(e.target.value)}
        hint="Give this password to the staff member. It will not be shown again."
      />
    </FormModal>
  )
}
