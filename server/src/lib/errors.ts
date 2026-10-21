/* Errors the API is willing to say out loud.

   Anything thrown that is not one of these is a bug, and the handler in
   index.ts turns it into a bare 500 with no detail. That asymmetry is the
   point: a message written here was written to be read by a user, and an
   accidental leak of a Prisma error string tells an attacker the schema.  */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** A stable machine-readable code, so the client can branch on the reason
        without string-matching a sentence that may be reworded. */
    readonly code: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export const badRequest = (m: string, code = 'BAD_REQUEST') => new HttpError(400, m, code)
export const unauthorized = (m = 'Sign in to continue.', code = 'UNAUTHORIZED') =>
  new HttpError(401, m, code)
export const forbidden = (m = 'Your account does not have permission to do this.', code = 'FORBIDDEN') =>
  new HttpError(403, m, code)
export const notFound = (m = 'Not found.', code = 'NOT_FOUND') => new HttpError(404, m, code)
export const conflict = (m: string, code = 'CONFLICT') => new HttpError(409, m, code)
