/* The two pieces of middleware every protected route uses.

   `requireAuth` resolves the session cookie and hangs the actor off the
   request. `requireAdmin` runs after it. Neither of them does any scoping -
   that is `learnerScope`, applied inside each route, because a middleware
   cannot know which table a handler is about to read and a middleware that
   *thought* it did would be the most dangerous kind of false comfort. */

import type { NextFunction, Request, Response } from 'express'
import { actorFromRequest, assertAdmin, type Actor } from './session.js'
import { forbidden, unauthorized } from '../lib/errors.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actor?: Actor
    }
  }
}

/* What an account still on a password somebody else set may call: who am I,
   and the change itself. Everything else is refused until the holder has
   chosen their own - a published default (admin / admin12345678) is no
   secret, so a session opened with one proves nothing about who is at the
   keyboard. Sign-out needs no session and is not behind requireAuth. */
const BEFORE_PASSWORD_CHANGE = new Set(['GET /api/auth/me', 'POST /api/auth/change-password'])

/** Throws 401 unless the request carries a live session. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const actor = await actorFromRequest(req)
    if (!actor) throw unauthorized()
    if (actor.mustChangePassword && !BEFORE_PASSWORD_CHANGE.has(`${req.method} ${req.baseUrl}${req.path}`)) {
      throw forbidden('Set a new password to continue.', 'PASSWORD_CHANGE_REQUIRED')
    }
    req.actor = actor
    next()
  } catch (err) {
    next(err)
  }
}

/** Must run after requireAuth. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.actor) throw unauthorized()
    assertAdmin(req.actor)
    next()
  } catch (err) {
    next(err)
  }
}

/**
 * The actor, or a throw.
 *
 * Handlers call this instead of reading `req.actor!`. The non-null assertion
 * would compile everywhere, including in a route somebody forgot to put
 * behind requireAuth - and there it would be `undefined` at runtime, inside
 * `learnerScope`, producing a query scoped to `schoolId: undefined`. Which is
 * a query for every school.
 */
export function actorOf(req: Request): Actor {
  if (!req.actor) throw unauthorized()
  return req.actor
}
