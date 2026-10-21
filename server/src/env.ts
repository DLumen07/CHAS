/* Configuration, validated once at boot.

   Every value the server needs is read here and nowhere else, and the process
   refuses to start if one is missing or malformed. That is deliberate: the
   alternative is `process.env.SESSION_SECRET` read at the moment the first
   user signs in, three hours after deployment, with `undefined` flowing into
   an HMAC and every session token in the system being forgeable.

   There are no fallback secrets. A default SESSION_SECRET would be identical
   on every deployment of this code, which is the same as having none.

   .env IS LOADED HERE, and it has to be here rather than in index.ts. This
   module reads process.env at import time, and ES module imports are
   evaluated before the importing module's own body runs - so a dotenv call at
   the top of index.ts would execute AFTER this file had already decided the
   configuration was missing. The server refused to boot against a .env that
   was sitting right there, correctly filled in, for exactly that reason.

   In a real deployment the variables come from the host and there is no .env
   to find; dotenv simply finds nothing and the host's values stand, so this
   costs a deployment nothing and saves every developer the same hour. */

import 'dotenv/config'
import { z } from 'zod'

const Env = z.object({
  DATABASE_URL: z.string().url('DATABASE_URL must be a postgresql:// connection string'),

  PORT: z.coerce.number().int().positive().default(4000),
  /* The interface to listen on. Unset means every interface, which is what a
     school server on the LAN wants. The desktop app sets 127.0.0.1: its API
     is for the window on the same machine and nothing else, and a laptop on
     the school Wi-Fi must not be answering health-record requests from the
     next room. */
  HOST: z.string().min(1).optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /* Credentialed CORS cannot use a wildcard - browsers reject
     `Access-Control-Allow-Origin: *` together with credentials - so this is an
     explicit allow-list, split on commas. */
  CORS_ORIGIN: z
    .string()
    .default('http://localhost:5173')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),

  /* 32 bytes of hex. Long enough that the hash of a session token cannot be
     brute-forced back to the token, and checked here rather than hoped for. */
  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 characters - generate one with `node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"`'),

  SESSION_TTL_HOURS: z.coerce.number().int().positive().max(720).default(12),

  /* Where the built front-end lives, if this process is also to serve it.

     WHY THIS EXISTS AT ALL, since the front-end has its own dev server and a
     deployment can put a CDN in front of it: the Electron build cannot use
     either. It loads the app over file://, and a file:// page is an opaque
     origin, so a fetch from it to http://localhost:4000 is cross-SITE. The
     session cookie is SameSite=Lax and is therefore not sent on that request.
     Sign-in appears to succeed and every call after it comes back 401.

     Serving the app from this process puts the page and the API on one
     origin, which is the arrangement the cookie was designed for - no CORS,
     no SameSite exemption, no token in localStorage standing in for a cookie
     that cannot travel. It is also what .env.example already describes as the
     normal deployment: both behind one domain.

     Unset by default, so an API-only deployment stays API-only. */
  APP_DIR: z.string().min(1).optional(),
})

const parsed = Env.safeParse(process.env)

if (!parsed.success) {
  /* Printed as a list of what is wrong rather than a stack trace. The person
     reading this is setting up a deployment, not debugging the server. */
  console.error('\n[chas] Cannot start: the environment is not configured.\n')
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
  }
  console.error('\n  Copy server/.env.example to server/.env and fill it in.\n')
  process.exit(1)
}

export const env = parsed.data

export const isProd = env.NODE_ENV === 'production'
