import { useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import {
  IdentificationBadge,
  Buildings,
  FirstAidKit,
  ShieldCheck,
  Prohibit,
  ArrowCounterClockwise,
  UserPlus,
  ArrowRight,
  Info,
  CheckCircle,
} from '@phosphor-icons/react'
import { Button, Field, IconChip, Panel, cx } from '@/components/ui'
import { Select } from '@/components/primitives'
import { ADMIN, NURSE } from '@/data/mock'
import { isAdmin, useRoster, useSchool, type Role, type StaffRecord } from '@/lib/records'

/* Who holds an account at this school, and what each one is allowed to see.

   TWO ROLES, both reading every section:

     School head    exports the SF8, posts the notices and issues the
                    accounts on this very screen.
     School nurse   weighs, keeps the immunization cards and meets the parents
                    of flagged children. She manages none of the school.

   There is no class-adviser account.

   WHAT THIS SCREEN DOES NOT DO, stated plainly because a roles table that
   looks like a user-management console invites the assumption: it does not
   create sign-in credentials, and it does not push anything to another
   laptop. Each install claims itself at first sign-in. What is edited here is the school's own record of who is
   who - the list the head keeps, which is what a division office asks for and
   what the next import has to agree with. The banner at the top says so. */

interface Account {
  id: string
  name: string
  role: Role
  active: boolean
  /** True once somebody has edited this row. */
  edited: boolean
  updatedAt?: string
  /** An account added on this workstation, with no baseline row behind it. */
  added: boolean
}

const ROLE_LABEL: Record<Role, string> = {
  admin: 'School head',
  nurse: 'School nurse',
}

const ROLE_OPTIONS = [
  { value: 'admin', label: ROLE_LABEL.admin },
  { value: 'nurse', label: ROLE_LABEL.nurse },
]

/** Whether a stored role is one this build still has. Records written before
    the class-adviser role was removed may carry 'adviser'. */
function isRole(v: unknown): v is Role {
  return v === 'admin' || v === 'nurse'
}

/* Reading order for the table: the head first, because hers is the row that
   grants the power to edit this screen at all. */
const ROLE_RANK: Record<Role, number> = { admin: 0, nurse: 1 }

/** The baseline account list: the head and the nurse.

    Derived from data/mock.ts rather than stored, for the same reason the
    roster is - it is the list a real import will replace, and a stored copy
    would quietly disagree with it. */
function baseline(): Omit<Account, 'edited' | 'updatedAt' | 'added'>[] {
  return [
    { id: 'head', name: ADMIN.name, role: 'admin' as Role, active: true },
    { id: 'nurse', name: NURSE.name, role: 'nurse' as Role, active: true },
  ]
}

function merge(over: Record<string, StaffRecord>): Account[] {
  const rows: Account[] = baseline().map((b) => {
    const rec = over[b.id]
    return {
      ...b,
      role: isRole(rec?.role) ? rec.role : b.role,
      active: rec?.active ?? b.active,
      edited: Boolean(rec),
      updatedAt: rec?.updatedAt,
      added: false,
    }
  })

  /* Accounts typed in here have no baseline row, so they are appended rather
     than merged. They carry their own name; that is the only thing that
     distinguishes them in the file. An account added as a class adviser,
     before that role was removed, is left out. */
  const known = new Set(rows.map((r) => r.id))
  for (const [id, rec] of Object.entries(over)) {
    if (known.has(id) || !rec?.name || !isRole(rec.role)) continue
    rows.push({
      id,
      name: rec.name,
      role: rec.role,
      active: rec.active,
      edited: true,
      updatedAt: rec.updatedAt,
      added: true,
    })
  }

  return rows.sort((a, b) => {
    if (a.role !== b.role) return ROLE_RANK[a.role] - ROLE_RANK[b.role]
    return a.name.localeCompare(b.name)
  })
}

function when(iso: string | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

export default function Roles() {
  const { install, ready } = useRoster()
  const { staff, setStaff, resetStaff } = useSchool()
  const [name, setName] = useState('')
  const [newRole, setNewRole] = useState<Role>('nurse')
  const [error, setError] = useState<string | null>(null)

  const rows = useMemo(() => merge(staff), [staff])
  const heads = rows.filter((r) => r.role === 'admin' && r.active).length

  /* The accounts are the head's to keep. */
  if (ready && !isAdmin(install)) return <Navigate to="/admin" replace />

  function add() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Type the name as a DepEd form would carry it.')
      return
    }
    if (rows.some((r) => r.name.toLowerCase() === trimmed.toLowerCase())) {
      setError('There is already an account under that name.')
      return
    }
    setStaff(`staff:${Date.now().toString(36)}`, {
      name: trimmed,
      role: newRole,
      active: true,
    })
    setName('')
    setError(null)
  }

  return (
    <div className="h-full overflow-auto px-6 pt-1 pb-6">
      {/* What this list is, and what it is not. One line, above the table,
          rather than a caveat repeated per row. */}
      <div className="mb-3.5 flex items-start gap-2.5 rounded-[14px] bg-wash px-4 py-2.5">
        <Info size={15} weight="fill" className="mt-px shrink-0 text-navy-700" />
        <p className="text-[11.5px] leading-relaxed text-muted">
          <span className="font-semibold text-navy-900">
            This is the school&rsquo;s record of who holds an account
          </span>{' '}
          - the list a division office asks for. Changing a role here does not create a password
          and does not reach another laptop: each install claims itself at first sign-in. Kept on
          this workstation only.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_312px]">
        <Panel
          title={
            <span className="flex items-center gap-2">
              <IconChip tone="navy">
                <IdentificationBadge size={14} weight="fill" />
              </IconChip>
              Accounts
            </span>
          }
          subtitle={`${rows.filter((r) => r.active).length} active of ${rows.length} on file`}
          bodyClass="overflow-x-auto px-0 pb-2"
        >
          <table className="w-full min-w-[560px] border-collapse text-[12px]">
            <thead className="text-left">
              <tr className="border-b border-line-soft text-[10px] font-semibold tracking-[0.06em] whitespace-nowrap text-placeholder uppercase">
                <th className="px-5 py-2.5 font-semibold">Name</th>
                <th className="px-2 py-2.5 font-semibold">Role</th>
                <th className="px-2 py-2.5 font-semibold">Status</th>
                <th className="px-5 py-2.5 text-right font-semibold">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isMe = install?.adviser === r.name
                /* The last active head may not be demoted or revoked from
                   this screen. Doing so leaves a school with nobody able to
                   open the school overview - and no way back, because the
                   screen that would undo it is the one just locked. */
                const lastHead = r.role === 'admin' && r.active && heads <= 1
                return (
                  <tr
                    key={r.id}
                    className={cx(
                      'border-b border-line-soft transition-colors duration-100 hover:bg-wash',
                      !r.active && 'opacity-55',
                    )}
                  >
                    <td className="px-5 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium whitespace-nowrap text-navy-900">
                          {r.name}
                        </span>
                        {isMe && (
                          <span className="rounded-full bg-navy-50 px-1.5 py-0.5 text-[10px] font-semibold text-navy-700">
                            This laptop
                          </span>
                        )}
                        {r.added && (
                          <span className="rounded-full bg-gold-100 px-1.5 py-0.5 text-[10px] font-semibold text-gold-700">
                            Added here
                          </span>
                        )}
                      </div>
                      {/* Under the name rather than in a column of its own.
                          Most rows have never been touched, so a "last
                          changed" column is empty six times out of seven and
                          costs the actions column the width it needs on a
                          1366px laptop. */}
                      {r.edited && (
                        <div className="mt-0.5 text-[10.5px] text-muted">
                          Changed {when(r.updatedAt)}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <Select
                        label={`Role for ${r.name}`}
                        value={r.role}
                        options={ROLE_OPTIONS}
                        onValueChange={(v) => {
                          if (lastHead && v !== 'admin') return
                          const role = v as Role
                          setStaff(r.id, {
                            name: r.added ? r.name : undefined,
                            role,
                            active: r.active,
                          })
                        }}
                        icon={
                          r.role === 'admin' ? (
                            <Buildings size={12} weight="fill" />
                          ) : (
                            <FirstAidKit size={12} weight="fill" />
                          )
                        }
                      />
                    </td>
                    <td className="px-2 py-2">
                      {r.active ? (
                        <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[var(--color-n)]">
                          <CheckCircle size={13} weight="fill" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-muted">
                          <Prohibit size={13} weight="fill" />
                          Revoked
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-2">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant={r.active ? 'danger' : 'secondary'}
                          disabled={lastHead}
                          title={
                            lastHead
                              ? 'The school must keep one active head, or nobody can open the school overview.'
                              : undefined
                          }
                          onClick={() =>
                            setStaff(r.id, {
                              name: r.added ? r.name : undefined,
                              role: r.role,
                              active: !r.active,
                            })
                          }
                          icon={
                            r.active ? (
                              <Prohibit size={13} weight="bold" />
                            ) : (
                              <ShieldCheck size={13} weight="bold" />
                            )
                          }
                        >
                          {r.active ? 'Revoke' : 'Restore'}
                        </Button>
                        {r.edited && (
                          <Button
                            variant="ghost"
                            onClick={() => resetStaff(r.id)}
                            title={
                              r.added
                                ? 'Remove this account'
                                : 'Put this row back the way the school list has it'
                            }
                            icon={<ArrowCounterClockwise size={13} weight="bold" />}
                          >
                            {r.added ? 'Remove' : 'Undo'}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Panel>

        {/* Dressed as the sign-in screen: yellow rule over the heading,
            52px fields with a glyph naming each one, navy button. The gold
            moved from the button to the rule - one accent per screen, and the
            rule is the better place to spend it. */}
        <Panel className="h-fit">
          <div className="h-1 w-9 rounded-full bg-seal-yellow" />
          <h2 className="mt-4 font-display text-[21px] leading-none font-bold tracking-[-0.02em] text-navy-900">
            Add an account
          </h2>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            A second head or nurse, when the school has one.
          </p>

          <div className="mt-5 space-y-4">
            <Field
              label="Name"
              placeholder="Mrs. C. Delos Reyes"
              value={name}
              leading={<UserPlus size={17} />}
              inputClassName="h-[52px] rounded-[12px] text-[14px]"
              onChange={(e) => {
                setName(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') add()
              }}
              error={error ?? undefined}
              hint="Written the way a DepEd form carries it: title, initial, surname."
            />

            <div>
              <span className="mb-1.5 block text-[11.5px] font-medium text-muted">Role</span>
              <Select
                label="Role for the new account"
                value={newRole}
                options={ROLE_OPTIONS}
                onValueChange={(v) => setNewRole(v as Role)}
              />
            </div>

            <p className="text-[11.5px] leading-relaxed text-muted">
              {newRole === 'admin'
                ? 'A school head sees every section.'
                : 'A school nurse sees every section - a child is sent to her from any of them. She reads the same roster as the head and manages none of the school’s settings.'}
            </p>

            <Button
              variant="primary"
              className="h-[52px] w-full rounded-[12px] text-[14px] font-semibold"
              onClick={add}
            >
              Add to the list
              <ArrowRight size={16} weight="bold" className="ml-1" />
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  )
}
