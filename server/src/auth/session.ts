/* Sign-in, sessions and the scoping rule.

   THE PASSPHRASE. Argon2id, which is what the Password Hashing Competition
   settled on and what OWASP recommends for new work. Not bcrypt: bcrypt
   silently truncates at 72 bytes and has no memory cost, so it is cheap to
   attack on a GPU. Not SHA-anything: a fast hash is the wrong primitive here
   by construction.

   Parameters below are OWASP's current floor. They travel INSIDE the stored
   hash string (`$argon2id$v=19$m=19456,t=2,p=1$...`), so raising them later
   re-hashes new passwords without invalidating old ones.

   THE SESSION. A random 32-byte token in an httpOnly cookie, with only its
   SHA-256 stored. Two consequences worth stating:

     - httpOnly means no script can read it, so an XSS in the React app cannot
       exfiltrate a session. This is the reason it is a cookie and not a token
       in localStorage, which is the common and worse choice.
     - Storing the hash means a database dump is not a set of live sessions.
       The token is shown to the user's browser once and never persisted
       anywhere in a usable form.

   Server-side sessions rather than JWTs, because a JWT cannot be revoked
   before it expires and the one thing a head must be able to do with a lost
   laptop is end its session now. Here that is a DELETE. */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2'
import type { Role, User } from '@prisma/client'
import type { Request, Response } from 'express'
import { db } from '../db.js'
import { env, isProd } from '../env.js'
import { forbidden, unauthorized } from '../lib/errors.js'

/* OWASP's minimum for Argon2id: 19 MiB, two passes, one lane. */
const ARGON = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const

export function hashPassword(plain: string): Promise<string> {
  return argonHash(plain, ARGON)
}

export async function verifyPassword(hashString: string, plain: string): Promise<boolean> {
  try {
    return await argonVerify(hashString, plain)
  } catch {
    /* A malformed hash in the column must read as "wrong password", never as
       a 500 that tells the caller this particular account is special. */
    return false
  }
}

export const SESSION_COOKIE = 'chas_session'

/* The token is hashed with the server secret mixed in, so the stored value is
   useless without it - a dump of the sessions table alone cannot be replayed
   even against this same code. */
function hashToken(token: string): string {
  return createHash('sha256').update(`${env.SESSION_SECRET}:${token}`).digest('hex')
}

export async function createSession(userId: string, userAgent: string | undefined) {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3600_000)

  await db.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
      /* Truncated. It is coarse provenance for the audit trail, not a device
         fingerprint, and a 2KB user-agent string in every session row is
         storage spent on nothing. */
      userAgent: userAgent?.slice(0, 200) ?? null,
    },
  })

  return { token, expiresAt }
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    /* Secure in production only, or the cookie is dropped over plain http on
       localhost and nobody can sign in while developing. */
    secure: isProd,
    /* 'lax' lets the cookie ride a top-level navigation back from an external
       redirect while still blocking it on cross-site POSTs, which is the CSRF
       case that matters for a JSON API. */
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  })
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/' })
}

export async function destroySession(token: string) {
  await db.session.deleteMany({ where: { tokenHash: hashToken(token) } })
}

/** Everything the request handlers are allowed to know about who is calling. */
export interface Actor {
  id: string
  username: string
  fullName: string
  role: Role
  schoolId: string
  /** A password somebody else set is still in use - see requireAuth. */
  mustChangePassword: boolean
}

function toActor(u: User): Actor {
  return {
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    role: u.role,
    schoolId: u.schoolId,
    mustChangePassword: u.mustChangePassword,
  }
}

/**
 * Resolve the session cookie to a user, or null.
 *
 * Expired rows are deleted on the way past rather than left for a cron job.
 * The table would otherwise grow forever with rows nothing can ever use.
 */
export async function actorFromRequest(req: Request): Promise<Actor | null> {
  const token = req.cookies?.[SESSION_COOKIE]
  if (typeof token !== 'string' || !token) return null

  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  })
  if (!session) return null

  if (session.expiresAt.getTime() <= Date.now()) {
    await db.session.delete({ where: { tokenHash: session.tokenHash } }).catch(() => {})
    return null
  }

  /* A disabled account keeps its rows - they are referenced by every
     measurement it wrote - but must stop being able to sign anything new. */
  if (session.user.disabledAt) return null

  return toActor(session.user)
}

/* Constant-time comparison for the one place a user-supplied string is
   compared against a secret that is not a hash. Not needed for the password
   (argon2's verify is already constant-time) but used by the sign-in path
   below to keep a missing username and a wrong password indistinguishable in
   timing as well as in wording. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/* --- The scoping rule ----------------------------------------------------

   THE SINGLE MOST IMPORTANT FUNCTION IN THIS SERVER.

   Both posts - the head and the nurse - read the whole school, so the scope
   is the school. It is still enforced in exactly one place - this - so that
   no endpoint can forget it and return another school's health records to
   anyone who edits the query string.

   So the rule is: no route builds its own `where` clause for learner-scoped
   data. Every one of them starts from this.
-------------------------------------------------------------------------- */

/**
 * The `where` fragment that limits a query to what this actor may read: their
 * school. Both roles are school-wide - see the Role enum in the schema.
 */
export function learnerScope(actor: Actor): { schoolId: string } {
  return { schoolId: actor.schoolId }
}

/**
 * Assert that this actor may touch this learner, by id.
 *
 * Used on every write. A scoped LIST is not enough on its own: anyone who
 * knows a learner id from any source could otherwise POST a measurement onto
 * a child in another school, and the list endpoint would never show it.
 */
export async function assertLearnerInScope(actor: Actor, learnerId: string): Promise<void> {
  const found = await db.learner.findFirst({
    where: { id: learnerId, ...learnerScope(actor) },
    select: { id: true },
  })
  /* 404, not 403. Telling a caller "this learner exists but is not yours"
     confirms the existence of a record they have no business knowing about,
     and the id is the only thing they would need to enumerate the school. */
  if (!found) throw unauthorized('That learner was not found.', 'OUT_OF_SCOPE')
}

/** Routes only an ADMIN may call.
 *
 * The nurse reads every section and still may not do any of this: accounts,
 * weighing rounds, the SF8 and the school's notices are the head's. Scope and
 * privilege are two different questions. */
export function assertAdmin(actor: Actor): void {
  if (actor.role !== 'ADMIN') {
    throw forbidden(
      'Only the school head can do this.',
      'ADMIN_ONLY',
    )
  }
}
