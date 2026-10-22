/* Staff accounts, managed by the school head.

   WHY THIS EXISTS. A real school's staff is not known to this repository, changes every June, and is
   nobody's business to hardcode. The head now creates the accounts, which is
   also the only arrangement in which the passphrase is a secret - a seeded
   account's passphrase is in a file in version control and known to everyone
   who has ever read it.

   WHAT IS ENFORCED HERE, rather than in the screen that calls it. The Roles
   screen has the same rules in it so a person is not offered a control that
   will fail, but the screen is a courtesy and this file is the guarantee:
   anything below is true even for a request typed by hand at the API.

     - Admin only. Every route sits behind requireAdmin. The nurse reads
       every section and still cannot open this file's routes: seeing the
       roster and issuing the keys to it are separate powers, and only one of
       them is hers.
     - One school. Every query is scoped to the actor's own schoolId, and a
       user id belonging to another school reads as not found rather than as
       forbidden, so this endpoint cannot be used to discover that an id
       exists somewhere else.
     - The last active head cannot be disabled or demoted. A school with no
       head has nobody who can create one, and the screen that would undo it
       is the one just locked.
     - Nobody disables their own account, for the same reason.
     - A DELETED account leaves the list for good, but its row stays.
       Every measurement, absence and slip carries the id of the person who
       recorded it; removing the row would orphan a year of evidence to tidy
       a list. Deleting signs it out, blocks sign-in and frees the username.

   PASSPHRASES. Set by the head at creation and reset by the head when one is
   forgotten. Each account can also get back in with its own recovery codes
   from the sign-in screen - see routes/auth.ts.
   The plaintext is returned exactly once, in the response to the request that
   set it, and is never stored or logged. The audit line says a passphrase was
   set and by whom, never what it was. */

import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db.js'
import { audit } from '../lib/audit.js'
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js'
import { h, ipOf } from '../lib/http.js'
import { requireAuth, requireAdmin, actorOf } from '../auth/middleware.js'
import { hashPassword } from '../auth/session.js'

export const usersRouter = Router()

usersRouter.use(requireAuth, requireAdmin)

/* The shape the client gets. Never the hash, and never the whole row - a
   `select` upstream gaining a column must not silently start publishing it. */
const SELECT = {
  id: true,
  username: true,
  fullName: true,
  role: true,
  lastLoginAt: true,
  disabledAt: true,
  createdAt: true,
} as const

/** "Mrs. C. Delos Reyes" -> "c.delosreyes", the shape DepEd accounts use.

    Suggested, not imposed: the head can type any username they like. Two
    staff can genuinely share initials and surname, and a scheme that
    cannot express that is a scheme somebody works around with a digit. */
function usernameFor(fullName: string): string {
  const rest = fullName
    .trim()
    .replace(/^(Mrs|Mr|Ms|Gng|Bb|G)\.?\s+/i, '')
    .trim()
  const initial = rest.match(/^([A-Za-z])\.?\s+/)
  const given = initial ? initial[1] : (rest.split(/\s+/)[0] ?? '')
  const surname = (initial ? rest.slice(initial[0].length) : rest).trim()
  return `${given[0] ?? ''}.${surname.replace(/\s+/g, '')}`
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
}

/** How many heads this school would have left if `excluding` were gone. */
async function otherActiveAdmins(schoolId: string, excluding: string): Promise<number> {
  return db.user.count({
    where: { schoolId, role: 'ADMIN', disabledAt: null, deletedAt: null, id: { not: excluding } },
  })
}

/* Same rules the passphrase change uses. Twelve characters rather than a
   character-class rule, because length is what actually resists a guess and
   a symbol requirement mostly produces "Password1!". */
const Passphrase = z.string().min(12, 'Use at least twelve characters.').max(512)

/* Lowercased here, as sign-in lowercases what is typed, so "M.Cruz" and
   "m.cruz" are one name and never two accounts. */
const Username = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'A username needs at least three characters.')
  .max(32, 'A username can have at most 32 characters.')
  .regex(
    /^[a-z0-9._-]+$/,
    'Usernames are lowercase letters, digits, dots, dashes and underscores.',
  )
  /* A deleted account's username becomes "deleted.<id>" (see the DELETE
     route), so the prefix is kept for that. */
  .refine((u) => !u.startsWith('deleted.'), 'That username is reserved. Choose another.')

/* Two requests for the same name can both pass the lookup before either
   writes; the unique index stops the second, and it gets the same answer
   the lookup would have given. */
const takenAs = (username: string) => (err: unknown) => {
  if ((err as { code?: string } | null)?.code === 'P2002') {
    throw conflict(`The username "${username}" is already taken.`, 'USERNAME_TAKEN')
  }
  throw err
}

/* Letters, spaces, hyphens, apostrophes and periods - the learner name rule
   (2026-10-22), so "Mrs. A. Bantolo" passes and a name with digits does not. */
const FullName = z
  .string()
  .trim()
  .min(2, 'Enter the name as it appears on DepEd forms.')
  .max(120)
  .regex(/^\p{L}[\p{L}\p{M} .'’-]*$/u, 'The name can only have letters, spaces, hyphens, apostrophes and periods.')

const CreateUser = z.object({
  fullName: FullName,
  username: Username.optional(),
  password: Passphrase,
  role: z.enum(['ADMIN', 'NURSE']).default('NURSE'),
})

const UpdateUser = z.object({
  fullName: FullName.optional(),
  username: Username.optional(),
  role: z.enum(['ADMIN', 'NURSE']).optional(),
  /** true disables the account, false restores it. */
  disabled: z.boolean().optional(),
})

const ResetPassword = z.object({ password: Passphrase })

/** Everyone at this school.
 *
 * Ordered by the enum's own declaration order - the head, then the nurse -
 * and by name inside each. The screen does not re-sort it. */
usersRouter.get(
  '/',
  h(async (req, res) => {
    const actor = actorOf(req)
    const users = await db.user.findMany({
      where: { schoolId: actor.schoolId, deletedAt: null },
      select: SELECT,
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
    })
    res.json({ users })
  }),
)

usersRouter.post(
  '/',
  h(async (req, res) => {
    const actor = actorOf(req)
    const parsed = CreateUser.safeParse(req.body)
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message ?? 'Check the account details.', 'INVALID_BODY')
    }
    const { fullName, password, role } = parsed.data
    const username = (parsed.data.username ?? usernameFor(fullName)).toLowerCase()
    if (username.length < 3) {
      throw badRequest('Enter a username for this account.', 'INVALID_BODY')
    }

    const clash = await db.user.findUnique({
      where: { schoolId_username: { schoolId: actor.schoolId, username } },
      select: { id: true },
    })
    if (clash) {
      throw conflict(`The username "${username}" is already taken.`, 'USERNAME_TAKEN')
    }

    const user = await db.user
      .create({
        data: {
          schoolId: actor.schoolId,
          username,
          fullName,
          role,
          passwordHash: await hashPassword(password),
          /* The head knows this one; the holder replaces it at first sign-in. */
          mustChangePassword: true,
        },
        select: SELECT,
      })
      .catch(takenAs(username))

    /* The username and the role, never the passphrase and never the hash. */
    audit({
      actorId: actor.id,
      action: 'ACCOUNT_CREATED',
      targetType: 'user',
      targetId: user.id,
      detail: { username, role },
      ipAddress: ipOf(req),
    })

    res.status(201).json({ user })
  }),
)

usersRouter.patch(
  '/:id',
  h(async (req, res) => {
    const actor = actorOf(req)
    const parsed = UpdateUser.safeParse(req.body)
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message ?? 'Check the changes.', 'INVALID_BODY')
    }

    /* Scoped to the school in the lookup itself. An id from another school
       reads as "not found", which is also the truth as far as this actor is
       concerned. */
    const target = await db.user.findFirst({
      where: { id: req.params.id, schoolId: actor.schoolId, deletedAt: null },
      select: { id: true, role: true, username: true, disabledAt: true },
    })
    if (!target) throw notFound('That account was not found.', 'NO_USER')

    const { fullName, username, role, disabled } = parsed.data
    const nextRole = role ?? target.role
    const willBeDisabled = disabled ?? target.disabledAt !== null

    if (target.id === actor.id && disabled === true) {
      throw forbidden('You cannot switch off the account you are signed in with.', 'SELF_DISABLE')
    }

    /* The last head keeps the school reachable. Checked for BOTH ways of
       losing one - demotion and disabling - because either leaves the same
       school with nobody who can undo it. */
    const losingAdmin =
      target.role === 'ADMIN' && target.disabledAt === null && (nextRole !== 'ADMIN' || willBeDisabled)
    if (losingAdmin && (await otherActiveAdmins(actor.schoolId, target.id)) === 0) {
      throw forbidden(
        'This is the only active school head account. Make another account a school head first.',
        'LAST_ADMIN',
      )
    }

    if (username && username !== target.username) {
      const clash = await db.user.findUnique({
        where: { schoolId_username: { schoolId: actor.schoolId, username } },
        select: { id: true },
      })
      if (clash) {
        throw conflict(`The username "${username}" is already taken.`, 'USERNAME_TAKEN')
      }
    }

    /* A new username keeps the account's sessions: a session points at the
       user's id, not the name, so the person stays signed in, and every
       record and audit line they made still points at them. Only the next
       sign-in needs the new name. */
    const user = await db.user
      .update({
        where: { id: target.id },
        data: {
          ...(fullName !== undefined && { fullName }),
          ...(username !== undefined && { username }),
          ...(role !== undefined && { role }),
          ...(disabled !== undefined && { disabledAt: disabled ? new Date() : null }),
        },
        select: SELECT,
      })
      .catch(takenAs(username ?? target.username))

    /* Disabling ends the account's sessions. Leaving them alive would make
       the control cosmetic until the cookie happened to expire, which on a
       12-hour TTL is most of a school day. */
    if (disabled === true) await db.session.deleteMany({ where: { userId: target.id } })

    audit({
      actorId: actor.id,
      action: disabled === true ? 'ACCOUNT_DISABLED' : disabled === false ? 'ACCOUNT_RESTORED' : 'ACCOUNT_UPDATED',
      targetType: 'user',
      targetId: target.id,
      detail: {
        username: user.username,
        role: user.role,
        ...(user.username !== target.username && { previousUsername: target.username }),
      },
      ipAddress: ipOf(req),
    })

    res.json({ user })
  }),
)

/** Set a new passphrase for somebody who has forgotten theirs. */
usersRouter.post(
  '/:id/password',
  h(async (req, res) => {
    const actor = actorOf(req)
    const parsed = ResetPassword.safeParse(req.body)
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message ?? 'Check the password.', 'INVALID_BODY')
    }

    const target = await db.user.findFirst({
      where: { id: req.params.id, schoolId: actor.schoolId, deletedAt: null },
      select: { id: true, username: true },
    })
    if (!target) throw notFound('That account was not found.', 'NO_USER')

    await db.user.update({
      where: { id: target.id },
      /* As at creation: the head chose it, so the holder replaces it. */
      data: { passwordHash: await hashPassword(parsed.data.password), mustChangePassword: true },
    })
    /* Every session that account holds dies with the old passphrase, for the
       same reason a self-service change ends them: a reset is what happens
       after somebody thinks the old one was seen. */
    await db.session.deleteMany({ where: { userId: target.id } })

    audit({
      actorId: actor.id,
      action: 'PASSWORD_RESET_BY_ADMIN',
      targetType: 'user',
      targetId: target.id,
      detail: { username: target.username },
      ipAddress: ipOf(req),
    })

    res.json({ ok: true })
  }),
)

/** Delete an account. See the note at the top: the row is kept and marked. */
usersRouter.delete(
  '/:id',
  h(async (req, res) => {
    const actor = actorOf(req)
    const target = await db.user.findFirst({
      where: { id: req.params.id, schoolId: actor.schoolId, deletedAt: null },
      select: { id: true, role: true, username: true, disabledAt: true },
    })
    if (!target) throw notFound('That account was not found.', 'NO_USER')

    if (target.id === actor.id) {
      throw forbidden('You cannot delete the account you are signed in with.', 'SELF_DELETE')
    }
    if (
      target.role === 'ADMIN' &&
      target.disabledAt === null &&
      (await otherActiveAdmins(actor.schoolId, target.id)) === 0
    ) {
      throw forbidden(
        'This is the only active school head account. Make another account a school head first.',
        'LAST_ADMIN',
      )
    }

    const now = new Date()
    await db.$transaction([
      db.user.update({
        where: { id: target.id },
        data: {
          deletedAt: now,
          disabledAt: target.disabledAt ?? now,
          /* Freed for a new account; the id keeps it unique. */
          username: `deleted.${target.id}`,
          /* Not a hash of anything, so no passphrase can ever match it. */
          passwordHash: '!deleted',
        },
      }),
      db.session.deleteMany({ where: { userId: target.id } }),
    ])

    audit({
      actorId: actor.id,
      action: 'ACCOUNT_DELETED',
      targetType: 'user',
      targetId: target.id,
      detail: { username: target.username, role: target.role },
      ipAddress: ipOf(req),
    })

    res.status(204).end()
  }),
)
