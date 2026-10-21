/* The CHAS API.

   Express 4, one process, talking to one Postgres. It replaces the JSON file
   in `electron/store.cjs` as the source of truth; the desktop build and the
   browser build are now both clients of this.

   ORDER MATTERS in the stack below, and not only stylistically:
     helmet before anything that can respond, so the headers are on errors too
     cors before the routes, so a preflight never reaches a handler
     cookie-parser before requireAuth, which reads req.cookies
     the error handler LAST, because Express identifies it by arity and only
       finds it if nothing has already responded
*/

import { existsSync } from 'node:fs'
import path, { join, sep } from 'node:path'
import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { env, isProd } from './env.js'
import { db } from './db.js'
import { HttpError } from './lib/errors.js'
import { authRouter } from './routes/auth.js'
import { learnersRouter } from './routes/learners.js'
import { usersRouter } from './routes/users.js'
import { recordsRouter } from './routes/records.js'
import { schoolYearRouter } from './routes/school-year.js'
import { schoolRouter } from './routes/school.js'
import { classesRouter } from './routes/classes.js'

const app = express()

/* Behind a reverse proxy on every managed host. Without this, `req.ip` is the
   proxy's address for every request - which makes the sign-in rate limiter
   count the whole internet as one client, and writes a useless address into
   every audit row.

   `1`, not `true`. `true` trusts the entire X-Forwarded-For chain, and that
   header is client-supplied: an attacker prepends a fake address and defeats
   the rate limiter. One hop is the number of proxies actually in front. */
app.set('trust proxy', 1)

/* No `X-Powered-By: Express`, plus HSTS, nosniff and frame-deny.

   The CSP used to be close to moot here, because this process returned only
   JSON and whatever served the front-end carried the policy that mattered.
   With APP_DIR set this process IS what serves the front-end, so the default
   policy is now load-bearing - and one directive has to be relaxed.

   'unsafe-inline' FOR STYLES ONLY. React sets element style attributes all
   over this app for values computed rather than known in advance: the band
   colour on a status chip, the width of every bar in the grade chart, the
   scrim behind the school photograph. A style ATTRIBUTE is blocked by
   style-src without this, and it cannot be nonced - nonces apply to <style>
   and <link>, never to the attribute. Scripts keep the strict default, which
   is the directive that actually stops an injected string executing. */
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'style-src': ["'self'", "'unsafe-inline'"],
        /* Same origin only. The app talks to /api on this very host, and a
           school workstation has no business reaching anywhere else. */
        'connect-src': ["'self'"],
        'img-src': ["'self'", 'data:'],
        /* helmet's default also allows any https: host. The fonts are
           bundled, so nothing outside this origin is needed. */
        'font-src': ["'self'", 'data:'],
        'object-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'self'"],
      },
    },
  }),
)

/* Credentialed CORS. The browser will not accept `*` together with
   credentials, so the origin is an explicit allow-list from the environment
   and an unknown origin is refused rather than reflected - reflecting the
   Origin header back is the mistake that turns CORS into no CORS at all. */
app.use(
  cors((req, cb) => {
    const origin = req.headers.origin
    /* No Origin header at all is a plain GET, curl, or a same-origin
       navigation. Nothing for CORS to decide. */
    if (!origin) return cb(null, { origin: true, credentials: true })

    /* The server's OWN origin is always allowed, and this is not a loosening.

       A browser does not apply CORS to a same-origin request - but it does
       still send an Origin header on a same-origin POST. So once this process
       serves the app as well as the API (APP_DIR), every sign-in arrives with
       `Origin: http://this-host:4000`, which was not in the allow-list, and
       the server refused its own front-end with a 403 that no browser rule
       required. Comparing against the Host the request was actually addressed
       to is exact: if they match, the page and the API are the same origin by
       definition, whatever hostname or port a given school uses. */
    const selfOrigin = `${req.protocol}://${req.get('host')}`
    if (origin === selfOrigin) return cb(null, { origin: true, credentials: true })

    if (env.CORS_ORIGIN.includes(origin)) return cb(null, { origin: true, credentials: true })
    cb(new Error(`Origin ${origin} is not allowed.`))
  }),
)

/* A body limit, because the default is 100kb of JSON parsed before any of our
   code runs and there is no endpoint here that wants more than a few hundred
   bytes. */
app.use(express.json({ limit: '64kb' }))
app.use(cookieParser())

/* A coarse ceiling on everything. The sign-in route has its own, much
   tighter, limiter; this one exists so a loop against any other endpoint
   cannot saturate the connection pool. */
app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  }),
)

/* Liveness. Deliberately does NOT touch the database: a health check that
   fails when Postgres blips gets the whole API restarted by the host's
   scheduler, which is the one thing guaranteed not to help. */
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'chas-api' })
})

/* Readiness DOES touch it - that is the difference. This is what a deployment
   waits on before sending traffic. */
app.get('/ready', async (_req, res) => {
  try {
    await db.$queryRaw`SELECT 1`
    res.json({ ok: true })
  } catch {
    res.status(503).json({ ok: false, error: 'database unavailable' })
  }
})

app.use('/api/auth', authRouter)
app.use('/api/learners', learnersRouter)
/* Staff accounts. Admin-only, enforced inside the router rather than here,
   so the rule travels with the routes. */
app.use('/api/users', usersRouter)
app.use('/api/school-year', schoolYearRouter)
/* The school's details and logo. Reading is public (the sign-in screen
   prints them); writing is the head's, enforced inside the router. */
app.use('/api/school', schoolRouter)
app.use('/api/classes', classesRouter)
app.use('/api', recordsRouter)

/* --- The front-end, when this process is serving it ----------------------

   Mounted AFTER every /api route and before the 404, so a mistyped endpoint
   still gets the JSON "no such endpoint" rather than being handed index.html
   with a 200 - which is the failure that makes a client report "the API
   returned HTML" and nobody able to find why.

   The SPA fallback is deliberately narrow. The app uses HashRouter, so every
   route it has lives after a '#' and never reaches the server; the only paths
   the server sees are the document itself and its assets. A blanket
   send-index-for-everything would therefore serve HTML for a genuinely
   missing asset and turn a 404 on a chunk into a syntax error in the console.
------------------------------------------------------------------------- */
if (env.APP_DIR) {
  const appDir = path.resolve(env.APP_DIR)
  if (!existsSync(join(appDir, 'index.html'))) {
    console.error(`[chas] APP_DIR has no index.html: ${appDir}`)
    process.exit(1)
  }

  app.use(
    express.static(appDir, {
      /* The hashed asset filenames Vite emits are immutable by construction,
         and index.html must never be, or a rebuilt app keeps loading the
         chunks it shipped with. */
      setHeaders(res, filePath) {
        if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-store')
        else if (filePath.includes(`${sep}assets${sep}`))
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      },
    }),
  )

  app.get('/', (_req, res) => {
    res.sendFile(join(appDir, 'index.html'))
  })

  console.log(`[chas] serving the app from ${appDir}`)
}

app.use((_req, res) => {
  res.status(404).json({ error: 'This action is not available.', code: 'NO_ROUTE' })
})

/* The error handler.

   An HttpError was written to be read by a user and is passed through. Nothing
   else is: an unexpected throw is a bug, and its message is a Prisma string
   naming a column, or a stack trace naming a path on the server. Those go to
   the log and the caller gets a bare 500.

   The four-argument signature is load-bearing - Express identifies error
   middleware by arity, so `_next` cannot be dropped even though it is
   unused. */
app.use(
  (
    err: unknown,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, code: err.code })
    }

    if (err instanceof Error && err.message.startsWith('Origin ')) {
      return res.status(403).json({ error: 'This action is not allowed.', code: 'CORS' })
    }

    console.error('[chas] unhandled error on', req.method, req.path, err)
    res.status(500).json({ error: 'An unexpected error occurred.', code: 'INTERNAL' })
  },
)

const onListening = () => {
  console.log(`[chas] API listening on ${env.HOST ?? ''}:${env.PORT} (${env.NODE_ENV})`)
  if (!isProd) console.log(`[chas] CORS origins: ${env.CORS_ORIGIN.join(', ')}`)
}
const server = env.HOST
  ? app.listen(env.PORT, env.HOST, onListening)
  : app.listen(env.PORT, onListening)

/* Finish in-flight requests before exiting. A host sends SIGTERM and then
   SIGKILLs after a grace period; without this, whatever measurement was
   mid-write when a deploy rolled is simply lost. */
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.log(`[chas] ${signal} received, closing`)
    server.close(() => {
      void db.$disconnect().then(() => process.exit(0))
    })
    /* A hung connection must not hold the deploy open forever. */
    setTimeout(() => process.exit(1), 10_000).unref()
  })
}
