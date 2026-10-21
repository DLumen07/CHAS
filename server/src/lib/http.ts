/* Two small helpers every route file uses. */

import type { NextFunction, Request, RequestHandler, Response } from 'express'

/**
 * Wrap an async handler so a rejected promise reaches Express's error
 * handler.
 *
 * Express 4 does not await handlers, so an async function that throws
 * produces an unhandled rejection and a request that hangs until the client
 * times out - with no stack trace anywhere useful. Every async route in this
 * server is wrapped in this. Express 5 makes it unnecessary; this pins to 4
 * because the ecosystem around it is still where the middleware is.
 */
export function h(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next)
  }
}

/** The client's address, for the audit trail. */
export function ipOf(req: Request): string | undefined {
  /* `req.ip` already honours the `trust proxy` setting configured in
     index.ts, so this does not parse X-Forwarded-For by hand - doing that
     without knowing how many proxies are in front is how a spoofable client
     header ends up in an audit log. */
  return req.ip
}
