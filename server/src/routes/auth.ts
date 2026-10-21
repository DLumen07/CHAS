/* Sign in, sign out, and "who am I".

   The sign-in screen this backs has always had a passphrase field that
   unlocked nothing - `store.cjs` said so in a comment. This is the endpoint
   that makes it real. */

import { Router } from 'express'
import { z } from 'zod'
import rateLimit from 'express-rate-limit'
import { db } from '../db.js'
import { env } from '../env.js'
import { audit } from '../lib/audit.js'
import { badRequest, unauthorized } from '../lib/errors.js'
import { h, ipOf } from '../lib/http.js'
import { RECOVERY_CODE_COUNT, newRecoveryCode, normalizeRecoveryCode } from '../lib/recovery.js'
import { requireAuth, actorOf } from '../auth/middleware.js'
import { IDENTITY_SELECT, schoolIdentity } from './school.js'
import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  destroySession,
  hashPassword,
  setSessionCookie,
  verifyPassword,
} from '../auth/session.js'

export const authRouter = Router()

/* Sign-in is the one endpoint worth guessing at, so it is the one endpoint
   that is rate limited. Keyed on IP: ten attempts in fifteen minutes is far
   more than a person mistyping a passphrase and far less than a useful
   dictionary run.

   Not keyed on username, deliberately - that would let an attacker lock a
   known account out of its own laptop by failing against it on purpose. */
const signInLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  /* FAILED attempts only. This counted every request, which made the rule
     something quite different from what the paragraph above describes: ten
     SIGN-INS per fifteen minutes, not ten guesses.

     That is a real deployment failure and not a theoretical one. A school
     puts its workstations behind one NAT address, so the whole staff shares
     this counter - the whole staff signing in after assembly is
     seven of the ten before anybody has mistyped anything. The eleventh
     person to arrive is told to wait fifteen minutes, having done nothing
     wrong and having no way to know why.

     Counting only failures is what the comment above always meant: ten wrong
     passwords is far more than a person mistyping one and far less than a
     useful dictionary run. A correct sign-in now costs nothing. */
  skipSuccessfulRequests: true,
  message: { error: 'Too many sign-in attempts. Wait fifteen minutes and try again.' },
})

const Credentials = z.object({
  username: z.string().trim().min(1).max(64).toLowerCase(),
  /* No maximum-length rule beyond a sane cap, and no composition rules.
     Argon2id does not truncate the way bcrypt does, so a long passphrase is
     simply better - and "must contain a symbol" is the requirement that makes
     people write the passphrase on the laptop. */
  password: z.string().min(1).max(512),
})

authRouter.post(
  '/sign-in',
  signInLimiter,
  h(async (req, res) => {
    const parsed = Credentials.safeParse(req.body)
    if (!parsed.success) throw badRequest('Enter a username and a password.', 'INVALID_BODY')
    const { username, password } = parsed.data

    const user = await db.user.findFirst({
      where: { username },
    })

    /* A missing username and a wrong passphrase must be indistinguishable -
       in the response AND in the time taken. Without the dummy verify below,
       a missing user returns in a millisecond and a real one takes ~50ms of
       Argon2, which is a reliable oracle for enumerating who has an account
       at this school. */
    if (!user) {
      await verifyPassword(
        '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2E$0000000000000000000000000000000000000000000',
        password,
      )
      audit({
        actorId: null,
        action: 'LOGIN_FAILED',
        detail: { reason: 'no_such_user' },
        ipAddress: ipOf(req),
      })
      throw unauthorized('That username and password do not match.', 'BAD_CREDENTIALS')
    }

    const ok = await verifyPassword(user.passwordHash, password)
    if (!ok) {
      audit({
        actorId: user.id,
        action: 'LOGIN_FAILED',
        detail: { reason: 'bad_passphrase' },
        ipAddress: ipOf(req),
      })
      throw unauthorized('That username and password do not match.', 'BAD_CREDENTIALS')
    }

    if (user.disabledAt) {
      audit({
        actorId: user.id,
        action: 'LOGIN_FAILED',
        detail: { reason: 'disabled' },
        ipAddress: ipOf(req),
      })
      throw unauthorized('This account is switched off. Ask the school head to switch it on.', 'ACCOUNT_DISABLED')
    }

    const { token, expiresAt } = await createSession(user.id, req.get('user-agent') ?? undefined)
    setSessionCookie(res, token, expiresAt)

    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

    audit({
      actorId: user.id,
      action: 'LOGIN_SUCCEEDED',
      detail: { role: user.role },
      ipAddress: ipOf(req),
    })

    res.json({ user: publicUser(user), expiresAt })
  }),
)

authRouter.post(
  '/sign-out',
  h(async (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE]
    if (typeof token === 'string' && token) await destroySession(token)
    clearSessionCookie(res)
    /* 204 whether or not there was a session. Signing out is idempotent, and
       a 401 here would make a user with an already-expired cookie unable to
       clear it. */
    res.status(204).end()
  }),
)

/* The school year and the school's details, for the sign-in screen, which
   prints them before anybody has signed in. Nothing here that is not
   already on that screen. */
authRouter.get(
  '/school',
  h(async (_req, res) => {
    const school = await db.school.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { ...IDENTITY_SELECT, schoolYear: true },
    })
    res.json({ schoolYear: school?.schoolYear ?? null, school: school ? schoolIdentity(school) : null })
  }),
)

/* The client calls this on boot to find out whether the cookie it is holding
   is still good, and who it belongs to. It replaces the `install` object the
   desktop build kept in its records file: identity now comes from the server,
   so a laptop cannot claim to be a section it was not issued. */
authRouter.get(
  '/me',
  requireAuth,
  h(async (req, res) => {
    const actor = actorOf(req)
    const user = await db.user.findUnique({
      where: { id: actor.id },
    })
    if (!user) throw unauthorized()
    res.json({ user: publicUser(user) })
  }),
)

/* Changing your own passphrase. Requires the current one even though the
   session already proves identity: a session is "this browser was signed in
   at some point", and an unattended laptop is exactly the case where that is
   not the same as "the account holder is here now". */
const ChangePassword = z.object({
  currentPassword: z.string().min(1).max(512),
  newPassword: z.string().min(12, 'Use at least twelve characters.').max(512),
})

authRouter.post(
  '/change-password',
  requireAuth,
  h(async (req, res) => {
    const actor = actorOf(req)
    const parsed = ChangePassword.safeParse(req.body)
    if (!parsed.success) {
      throw badRequest(
        parsed.error.issues[0]?.message ?? 'Check the passwords.',
        'INVALID_BODY',
      )
    }

    const user = await db.user.findUnique({ where: { id: actor.id } })
    if (!user) throw unauthorized()

    if (!(await verifyPassword(user.passwordHash, parsed.data.currentPassword))) {
      audit({
        actorId: user.id,
        action: 'PASSWORD_CHANGE_FAILED',
        ipAddress: ipOf(req),
      })
      throw unauthorized('That is not your current password.', 'BAD_CREDENTIALS')
    }

    /* Keeping the password is not changing it, and for an account on a
       published default it would clear the flag below with the default
       still in place. */
    if (parsed.data.newPassword === parsed.data.currentPassword) {
      throw badRequest('Choose a password different from the current one.', 'SAME_PASSWORD')
    }

    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(parsed.data.newPassword), mustChangePassword: false },
    })

    /* Every other session for this user dies. A passphrase change is what
       somebody does after they think it was seen, and leaving the other
       sessions alive would make the change cosmetic. The current one is
       re-issued so the person doing it is not signed out of their own
       browser. */
    await db.session.deleteMany({ where: { userId: user.id } })
    const { token, expiresAt } = await createSession(user.id, req.get('user-agent') ?? undefined)
    setSessionCookie(res, token, expiresAt)

    audit({ actorId: user.id, action: 'PASSWORD_CHANGED', ipAddress: ipOf(req) })
    res.json({ ok: true, expiresAt })
  }),
)

/* --- Forgotten passwords ------------------------------------------------

   Two ways back in, both offline:

     1. A recovery code (/recover), from the sheet each account prints on
        My account. Head and nurse alike.
     2. The head sets a new password on the Roles screen (routes/users.ts).

   Email reset was built and then removed (2026-10-14): CHAS runs offline on
   one machine, and a feature that needs internet and a Gmail account is
   one more thing to set up and one more thing that fails on the day.

   Both end every session the account holds, as a password change does. */

/* Entering a recovery code is a guess at a secret, so it is limited like
   sign-in: failures only. */
const codeLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many attempts. Wait fifteen minutes and try again.' },
})

const Username = z.string().trim().min(1).max(64).toLowerCase()
const NewPassword = z.string().min(12, 'Use at least twelve characters.').max(512)

const ResetWithRecovery = z.object({
  username: Username,
  code: z.string().trim().min(1, 'Enter a recovery code.').max(64),
  password: NewPassword,
})

authRouter.post(
  '/recover',
  codeLimiter,
  h(async (req, res) => {
    const parsed = ResetWithRecovery.safeParse(req.body)
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message ?? 'Check the details.', 'INVALID_BODY')
    }
    const { username, password } = parsed.data
    const code = normalizeRecoveryCode(parsed.data.code)
    const bad = () =>
      badRequest('That username and recovery code do not match.', 'BAD_RECOVERY_CODE')

    const user = await db.user.findFirst({
      where: { username, deletedAt: null, disabledAt: null },
      select: { id: true, recoveryCodes: { where: { usedAt: null }, select: { id: true, codeHash: true } } },
    })

    let matched: string | null = null
    for (const c of user?.recoveryCodes ?? []) {
      if (await verifyPassword(c.codeHash, code)) {
        matched = c.id
        break
      }
    }
    if (!user || !matched) {
      audit({
        actorId: user?.id ?? null,
        action: 'RECOVERY_CODE_FAILED',
        ipAddress: ipOf(req),
      })
      throw bad()
    }

    await db.$transaction([
      db.recoveryCode.update({ where: { id: matched }, data: { usedAt: new Date() } }),
      /* The holder chose this one, so nothing is left to change. */
      db.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(password), mustChangePassword: false },
      }),
      db.session.deleteMany({ where: { userId: user.id } }),
    ])

    const remaining = user.recoveryCodes.length - 1
    audit({
      actorId: user.id,
      action: 'PASSWORD_RESET_BY_RECOVERY_CODE',
      detail: { remaining },
      ipAddress: ipOf(req),
    })
    res.json({ ok: true, remaining })
  }),
)

/* --- Recovery codes, for the signed-in user's own account -----------------

   The head's and the nurse's way back in when the password is forgotten and
   there is no internet. Each account makes its own on My account. Shown once when created; only Argon2 hashes are kept. A new set
   replaces the old one, so a lost sheet is dealt with by making a new one. */

authRouter.get(
  '/recovery-codes',
  requireAuth,
  h(async (req, res) => {
    const actor = actorOf(req)
    const codes = await db.recoveryCode.findMany({
      where: { userId: actor.id },
      select: { usedAt: true, createdAt: true },
    })
    res.json({
      total: codes.length,
      remaining: codes.filter((c) => !c.usedAt).length,
      createdAt: codes[0]?.createdAt ?? null,
    })
  }),
)

authRouter.post(
  '/recovery-codes',
  requireAuth,
  h(async (req, res) => {
    const actor = actorOf(req)
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode)
    const hashes = await Promise.all(codes.map((c) => hashPassword(normalizeRecoveryCode(c))))

    await db.$transaction([
      db.recoveryCode.deleteMany({ where: { userId: actor.id } }),
      db.recoveryCode.createMany({
        data: hashes.map((codeHash) => ({ userId: actor.id, codeHash })),
      }),
    ])

    audit({
      actorId: actor.id,
      action: 'RECOVERY_CODES_CREATED',
      detail: { count: codes.length },
      ipAddress: ipOf(req),
    })
    res.status(201).json({ codes })
  }),
)

/* --- Confirming the password before a sensitive action (2026-10-14) ---------

   Backing up copies every learner's health record onto a drive that can
   leave the room; restoring replaces every record on this computer. Both ask
   the signed-in person to type their password again first, so a head's
   computer left signed in cannot be used for either by whoever sits down at
   it. A wrong password is a 400, not a 401: the session is still good, and
   the client must not read this as being signed out. Limited like sign-in. */

const ConfirmBody = z.object({
  password: z.string().min(1).max(512),
  purpose: z.enum(['backup', 'restore']),
})

authRouter.post(
  '/confirm-password',
  requireAuth,
  codeLimiter,
  h(async (req, res) => {
    const actor = actorOf(req)
    const parsed = ConfirmBody.safeParse(req.body)
    if (!parsed.success) throw badRequest('Enter your password.', 'INVALID_BODY')

    const user = await db.user.findUnique({ where: { id: actor.id }, select: { passwordHash: true } })
    if (!user) throw unauthorized()

    const ok = await verifyPassword(user.passwordHash, parsed.data.password)
    audit({
      actorId: actor.id,
      action: ok ? 'PASSWORD_CONFIRMED' : 'PASSWORD_CONFIRM_FAILED',
      detail: { purpose: parsed.data.purpose },
      ipAddress: ipOf(req),
    })
    if (!ok) throw badRequest('That password is not correct.', 'BAD_PASSWORD')
    res.json({ ok: true })
  }),
)

/* What the client is allowed to know about a user. Never the hash, and never
   the whole row - a `select` somewhere upstream changing would otherwise
   quietly start returning it. */
function publicUser(u: {
  id: string
  username: string
  fullName: string
  role: string
  schoolId: string
  lastLoginAt: Date | null
  mustChangePassword: boolean
}) {
  return {
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    role: u.role,
    schoolId: u.schoolId,
    lastLoginAt: u.lastLoginAt,
    /* The client shows the new-password screen instead of the app. */
    mustChangePassword: u.mustChangePassword,
    sessionTtlHours: env.SESSION_TTL_HOURS,
  }
}
