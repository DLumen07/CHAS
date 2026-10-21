# CHAS API

PostgreSQL-backed health records for Detailen Elementary School. Express 4,
Prisma 6, Argon2id, server-side sessions.

This replaces the JSON file in `electron/store.cjs` as the source of truth.

---

## Before anything is deployed

The app the front-end used to be told the user, on its own sign-in screen,
"Offline. Local records only" and "Covered by RA 10173". Putting the same data
behind an API changes what is true, so these are not optional:

| | |
|---|---|
| **TLS everywhere** | `sslmode=require` in `DATABASE_URL`, HTTPS in front of the API. These are minors' health records; an unencrypted hop puts them on the wire in plaintext. |
| **`SESSION_SECRET` set** | The server refuses to boot without one rather than falling back to a default that would be identical on every deployment. |
| **Seed passphrases changed** | `prisma/seed.ts` gives every account the same development passphrase and prints it. Change them, or seed with `SEED_PASSWORD`. The seed refuses to run under `NODE_ENV=production` unless you set it explicitly. |
| **Encryption at rest** | Whatever the host offers. Not implemented in application code. |
| **A backup you have restored from** | An untested backup is not a backup. |

The audit log is append-only but **not yet hash-chained** — `prevHash` and
`hash` exist and are null. That makes it tamper-*resistant*, not
tamper-*evident*. Don't claim otherwise in a defence.

---

## Local setup

```bash
cd server
npm install
cp .env.example .env
```

Generate a session secret and put it in `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Start Postgres. From the repo root, if you have Docker:

```bash
docker compose up -d
```

Otherwise point `DATABASE_URL` at any Postgres you have. Create the database
and role first — Prisma migrates a database, it does not create one:

```sql
CREATE ROLE chas WITH LOGIN PASSWORD 'chas';
CREATE DATABASE chas OWNER chas;
```

Then migrate and seed:

```bash
npm run db:migrate
npm run db:seed -- --with-measurements
npm run dev
```

`--with-measurements` loads the ~129 generated weigh-ins so the dashboards have
something to draw. Leave it off for a database that is about to hold real
records — see the note at the top of `prisma/seed.ts` about why fabricated
clinical rows are harder to remove than a fabricated roster.

Point the front-end at it. From the repo root:

```bash
echo "VITE_CHAS_BACKEND=server" > .env.local
npm run dev:renderer
```

Vite proxies `/api` to `:4000`, so the browser sees one origin and the session
cookie is same-origin — no CORS involved in development at all.

---

## Commands

| | |
|---|---|
| `npm run dev` | tsx watch, reloads on save |
| `npm run build` | `prisma generate` then `tsc` |
| `npm start` | run the built server |
| `npm run typecheck` | both tsconfigs — `src`, and the seed, which straddles packages |
| `npm run db:migrate` | create and apply a migration (development) |
| `npm run db:deploy` | apply existing migrations (production — never generates) |
| `npm run db:seed` | idempotent; add `-- --with-measurements` for demo data |
| `npm run db:studio` | browse the data in a browser |
| `npm run db:reset` | **drops everything**, re-migrates, re-seeds |

---

## API

All responses are JSON. Errors are `{ error, code }` — branch on `code`, never
on the sentence.

### Auth

| | |
|---|---|
| `POST /api/auth/sign-in` | `{username, password}` → sets an httpOnly cookie. Rate limited: 10 per 15 min per IP. |
| `POST /api/auth/sign-out` | Deletes the session row. 204 whether or not one existed. |
| `GET /api/auth/me` | The current user, or 401. |
| `POST /api/auth/change-password` | Requires the current passphrase. Kills every other session. |

### Data

| | |
|---|---|
| `GET /api/learners` | The roster, each learner merged with newest measurement, newest immunization check and current slip |
| `GET /api/learners/:id` | One learner, full history |
| `POST /api/measurements` | `{learnerId, heightCm, weightKg, measuredOn}` |
| `DELETE /api/measurements/:learnerId/:measuredOn` | Undo |
| `POST /api/absences` | `{learnerId, measuredOn}` |
| `POST /api/immunizations` | `{learnerId, status, checkedOn}` |
| `POST /api/slips` | `{learnerId, state, at?}` |
| `GET`/`PUT` `/api/meeting` | The meeting slips will name. `date` must be `YYYY-MM-DD` - it is a DATE column, and the readable Filipino form is made by the slip at print time |
| `GET /api/activity` | The activity feed, from the audit log |
| `GET /health`, `/ready` | Liveness (no DB) and readiness (DB) |

### Feeding program

Reading is scoped by learner like the roster. Both accounts - the nurse and
the head - may open, edit and close a program and mark its serving days.

| | |
|---|---|
| `GET /api/feeding` | Every program, newest window first, with a beneficiary count |
| `POST /api/feeding` | `{name, notes?, startsOn, endsOn}`. Names are unique per school |
| `PATCH /api/feeding/:id` | Rename, re-note, or move the window |
| `POST /api/feeding/:id/close` | `{reopen?: boolean}`. Closing is not a delete; the servings stay and the summary keeps printing |
| `GET /api/feeding/:id` | The program with its beneficiaries and every dated serving |
| `POST /api/feeding/:id/beneficiaries` | `{learnerIds[], reason?}`. Bulk. Every id is scope-checked; already-enrolled learners are skipped, not refused |
| `DELETE /api/feeding/:id/beneficiaries/:learnerId` | Take one off. Their servings cascade, so the screen asks first |
| `POST /api/feeding/:id/attendance` | `{servedOn, marks: [{learnerId, present}]}`. A whole day in one transaction. A date outside the window is refused |
| `GET /api/feeding/:id/summary` | Beneficiaries, serving days, present, absent, unmarked, rate, by sex, by section |

**No weigh-in rounds, no academic setup, no follow-ups.** These three routers
existed and were removed; their tables were dropped in migration
`8_drop_follow_ups_and_cycles`. A measurement is now an event with a date and
is filed without reference to any round.

### What is deliberately absent

**No `/api/summary`.** Every definition on the admin dashboard lives in
`src/lib/summary.ts` — what "healthy" means, which bands count as underweight,
when a slip is still owed. Reimplementing those as SQL aggregates would
create a second set that drifts from the first, and the two would disagree in a
report before anyone noticed. The client already holds the roster it needs to
count. If the school outgrows sending it whole, the aggregation moves here and
`summary.ts` becomes the spec it is written from.

**No band classification.** The server sends height, weight, birth date and
sex. `src/lib/nutrition.ts` turns those into WHO z-scores and bands, on the
client, as it always has — one implementation, and it is the one checked
against WHO's published tables to 0.0005.

---

## Authorization

`learnerScope()` in `src/auth/session.ts` limits every learner query to the
signed-in account's school. There are two roles and both are school-wide:

- **ADMIN** → the school head.
- **NURSE** → the school nurse. A flagged child is sent to her out of any
  section, so her roster is the whole school.

There is no class-adviser account. Advisers do not sign in; an adviser's name
is still printed on a section's SF8, but it is not a user. Migration
`9b_remove_adviser_role` disabled any adviser accounts that existed (their
recorded measurements keep their names) and dropped `users.sectionId`.

**Scope is not privilege**, and the two are separate functions on purpose.
`learnerScope` asks what an account may *see*; `assertAdmin` asks what it may
*change*. The nurse reads every section and still cannot create an account, open or
close a weighing round, export the SF8 or post a notice — those are the head's.
Collapsing the two tests would hand a clinical account the power to issue
another one.

Every list query starts from it. Every write calls `assertLearnerInScope`
first, because a scoped list is not enough on its own: anyone who learned a
learner id from anywhere could otherwise POST a measurement onto a child in
another school, and no list would ever show it. Out-of-scope returns 401, not
403 — "this exists but is not yours" confirms a record they should not know
about.

---

## Deployment

Portable — the server reads `DATABASE_URL`, `PORT`, `CORS_ORIGIN`,
`SESSION_SECRET`, `SESSION_TTL_HOURS` and nothing else. Any host that runs Node
and gives you a Postgres URL will do.

```
Build:    npm ci && npm run build
Release:  npm run db:deploy          # migrate BEFORE the new code serves traffic
Start:    npm start
Health:   /ready
```

`db:deploy`, never `db:migrate`, in production — `migrate dev` can generate and
can reset.

**Same origin or two?** Serving the app and the API from one domain is simpler:
leave `VITE_API_URL` empty and CORS never enters into it. If they are on
different origins, set `VITE_API_URL` to the API's origin **and**
`CORS_ORIGIN` to the app's, or the browser will silently refuse to send the
session cookie.

`app.set('trust proxy', 1)` assumes exactly one proxy in front. Change it if
your host has more; leaving it at `true` would let a client spoof
`X-Forwarded-For` and walk past the sign-in rate limiter.
