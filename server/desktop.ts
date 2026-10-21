/* The whole of CHAS on one machine: a private PostgreSQL, the API, the app.

   The school installs CHAS on one computer and that computer is the whole
   deployment - no server room, no network, no separate database install. The
   Electron main process imports this module and calls startDesktop(), which:

     1. starts a PostgreSQL that ships inside the installer, keeping its data
        in the app's own folder under %APPDATA%. The first launch creates the
        database cluster (about fifteen seconds, once); every launch after
        that starts it in under a second.
     2. applies any migration in prisma/migrations the database has not had
        yet - so an installer carrying a newer CHAS upgrades the school's
        database in place the first time it opens.
     3. on a database with no school in it, writes the school, its grade
        levels and sections, and the two accounts CHAS has. No learners: a
        real install starts with an empty roster and the nurse enrols the
        school's own children. The sample roster in src/data/mock.ts is for
        development and never reaches a school's database from here. (An
        installer built with `npm run dist:samples` adds the 25 sample
        learners in samples.ts - see addSamplesOnFirstLaunch.)
     4. starts the ordinary API (src/index.ts), unchanged, on 127.0.0.1 only,
        serving the built app from the same origin - the arrangement the
        session cookie was designed for.

   Outside src/ on purpose, like the seed: it reads the school's fixed facts
   from the front-end's src/data, which the server's own tsc build (rootDir
   src) must not pull in. It is bundled by scripts/build-desktop-server.mjs
   with esbuild, and type-checked by tsconfig.seed.json. */

import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { promisify } from 'node:util'
import {
  copyFileSync,
  cpSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  renameSync,
  rmSync,
} from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2'
import { SECTIONS, ADMIN, NURSE } from '../src/data/mock.js'
import { SCHOOL } from '../src/data/school.js'
import { SAMPLE_LRN_PREFIX, addSampleLearners } from './samples.js'

/* The first sign-in on a new install. Written down in the README's
   deployment section, so each account is created with mustChangePassword
   and the first sign-in asks for a new password before anything else
   (security assessment F3, 2026-10-19). They guard an API that listens on 127.0.0.1 only, so the
   exposure is the person at the keyboard - the same exposure a school's paper
   records have. */
export const FIRST_ACCOUNTS = {
  head: { username: 'admin', password: 'admin12345678' },
  nurse: { username: 's.nurse', password: 'nurse12345678' },
} as const

/* The head's first sign-in up to 0.2.0. A machine upgraded from that release
   whose head never changed it is moved onto the account above - see
   adoptNewDefaultHead(). */
const OLD_DEFAULT_HEAD = { username: 'a.bantolo', password: 'chas-head-2026' } as const

export interface DesktopOptions {
  /** Where the database cluster and this install's settings live. */
  dataDir: string
  /** The built front-end (vite build, server mode). */
  appDir: string
  /** prisma/migrations, shipped beside the bundle. */
  migrationsDir: string
  log: (line: string) => void
}

export interface Desktop {
  url: string
  /** Make the automatic backup, then stop the database. Called on quit. */
  stop: () => Promise<void>
  /** Copy the whole database into a new folder inside `parent`. */
  backupTo: (parent: string) => Promise<BackupResult>
  /** Put a backup in place of the current database. The app must restart
      straight after: the swap happens with the database stopped, and the
      next launch is what opens the restored copy. */
  restoreFrom: (folder: string) => Promise<void>
  /** How the last restore went, if there has been one. */
  lastRestore: () => RestoreOutcome | null
  /** The newest automatic backup, if there is one. */
  lastAutomatic: () => BackupManifest | null
  /** Where the automatic backups are kept. */
  automaticFolder: string
}

export interface BackupResult {
  folder: string
  createdAt: string
  learners: number
  measurements: number
}

/** What a backup folder says about itself, in chas-backup.json. */
export interface BackupManifest {
  app: 'CHAS'
  format: 1
  createdAt: string
  pgVersion: string
  school: string | null
  learners: number
  measurements: number
}

/** The outcome of the last restore, read by the Backup screen after the
    restart that a restore ends in. */
export interface RestoreOutcome {
  ok: boolean
  at: string
  from: string
  backupDate: string | null
  message?: string
}

/* --- Settings that must survive a restart ---------------------------------

   Generated once, on first launch, and kept beside the database. The
   Postgres password protects nothing a local user could not already read -
   it exists because Postgres wants one. The session secret signs session
   tokens and is per-install, never a constant in source control. The API
   port is remembered so the app's origin - and with it the signed-in
   session and any per-origin browser storage - is the same from one day to
   the next. */
interface LocalSettings {
  pgPassword: string
  sessionSecret: string
  pgPort: number
  apiPort: number
}

const PREFERRED_PG_PORT = 54329
const PREFERRED_API_PORT = 47810

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)))
  })
}

function anyFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo
      probe.close(() => resolve(port))
    })
  })
}

/* The remembered port if it is still free, else the preferred one, else any.
   Something else on the machine taking a port between launches is rare, and
   the cost is one fresh sign-in. */
async function pickPort(remembered: number | undefined, preferred: number): Promise<number> {
  for (const p of [remembered, preferred]) if (p && (await portIsFree(p))) return p
  return anyFreePort()
}

async function loadSettings(dataDir: string): Promise<LocalSettings> {
  const file = path.join(dataDir, 'settings.json')
  let saved: Partial<LocalSettings> = {}
  if (existsSync(file)) {
    try {
      saved = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      /* A settings file that will not parse keeps its secrets unreadable. The
         Postgres password cannot be regenerated without losing the cluster,
         so this is the one failure worth stopping on. */
      throw new Error(`The settings file is damaged: ${file}`)
    }
  }
  const settings: LocalSettings = {
    pgPassword: saved.pgPassword ?? randomBytes(24).toString('hex'),
    sessionSecret: saved.sessionSecret ?? randomBytes(32).toString('hex'),
    pgPort: await pickPort(saved.pgPort, PREFERRED_PG_PORT),
    apiPort: await pickPort(saved.apiPort, PREFERRED_API_PORT),
  }
  writeFileSync(file, JSON.stringify(settings, null, 2))
  return settings
}

/* --- PostgreSQL ------------------------------------------------------------ */

async function startPostgres(dataDir: string, s: LocalSettings, log: (l: string) => void) {
  const clusterDir = path.join(dataDir, 'pgdata')
  const pg = new EmbeddedPostgres({
    databaseDir: clusterDir,
    user: 'chas',
    password: s.pgPassword,
    port: s.pgPort,
    /* A new cluster checks passwords by SCRAM rather than receiving them in
       the clear. Clusters made by 0.7.0 and earlier are moved over by useScram(). */
    authMethod: 'scram-sha-256',
    persistent: true,
    onLog: (m) => log(`[postgres] ${String(m).trim()}`),
    onError: (m) => log(`[postgres] ${String(m).trim()}`),
  })

  /* PG_VERSION is the file initdb writes last-but-one and every later start
     relies on; its presence is the cheapest reliable "this cluster exists". */
  if (!existsSync(path.join(clusterDir, 'PG_VERSION'))) {
    /* A half-made cluster from a first launch that was killed part-way
       through has no PG_VERSION but is not empty, and initdb refuses a
       non-empty directory. Nothing in it can be user data yet. */
    if (existsSync(clusterDir)) rmSync(clusterDir, { recursive: true, force: true })
    log('[chas] first launch: creating the database (this takes a moment)')
    await pg.initialise()
  }

  try {
    await pg.start()
  } catch (err) {
    /* The one start failure worth handling: a postgres.exe left over from a
       session that ended in a crash or a power cut, still holding the
       cluster. Its PID is the first line of postmaster.pid. Stop it and try
       once more; anything else is reported as it is. */
    const pidFile = path.join(clusterDir, 'postmaster.pid')
    if (!existsSync(pidFile)) throw err
    const pid = Number(readFileSync(pidFile, 'utf8').split(/\r?\n/)[0])
    log(`[chas] a previous database process (${pid}) is still running; stopping it`)
    try {
      if (pid) process.kill(pid)
    } catch {
      /* Already gone: the pid file is simply stale. */
    }
    await new Promise((r) => setTimeout(r, 1500))
    rmSync(pidFile, { force: true })
    await pg.start()
  }

  return pg
}

/* Clusters made up to 0.7.0 were initialised with `--auth=password`, which
   has the client send the password in the clear on every connection. Moved to
   scram-sha-256 here, on the running cluster, before the API connects:

     1. the stored password must be a SCRAM verifier, or SCRAM sign-in fails.
        PostgreSQL 17 already stores one by default; an md5 one is re-set.
     2. pg_hba.conf has its `password` and `md5` methods replaced, and the
        server is told to reload it. Connections made after that use SCRAM.

   Also runs on a restored backup, which carries its own pg_hba.conf. A
   cluster already on SCRAM is left alone. */
async function useScram(pg: EmbeddedPostgres, clusterDir: string, pgPassword: string, log: (l: string) => void) {
  const hbaFile = path.join(clusterDir, 'pg_hba.conf')
  const hba = readFileSync(hbaFile, 'utf8')
  const OLD_METHOD = /^(\s*(?:local|host\w*)\s.*?\s)(password|md5)(\s*)$/
  const lines = hba.split(/\r?\n/)
  if (!lines.some((l) => OLD_METHOD.test(l))) return

  const client = pg.getPgClient('postgres')
  await client.connect()
  try {
    const { rows } = await client.query('SELECT rolpassword FROM pg_authid WHERE rolname = current_user')
    if (!String(rows[0]?.rolpassword ?? '').startsWith('SCRAM-SHA-256$')) {
      await client.query("SET password_encryption = 'scram-sha-256'")
      await client.query(`ALTER ROLE CURRENT_USER PASSWORD ${client.escapeLiteral(pgPassword)}`)
    }
    writeFileSync(hbaFile, lines.map((l) => l.replace(OLD_METHOD, '$1scram-sha-256$3')).join('\n'))
    await client.query('SELECT pg_reload_conf()')
  } finally {
    await client.end()
  }
  log('[chas] database sign-in moved to scram-sha-256')
}

/* A clean shutdown, which embedded-postgres does not do on Windows: its
   stop() runs `taskkill /f /t`, so every quit was a crash and every launch
   began with WAL recovery. Postgres survives that - it is what the WAL is for
   - but a laptop that is only ever shut down hard is one torn write away
   from a recovery that takes minutes on the morning of a weigh-in.

   `pg_ctl stop -m fast` rolls back open transactions, checkpoints and exits.
   If it cannot (it is not there, or it times out), the library's own kill
   still runs. After a clean stop the library's handle is cleared by hand:
   its stop() waits for an 'exit' event, and that event has already fired, so
   calling it - which its own exit hook also does - would wait forever. */
async function stopPostgres(pg: EmbeddedPostgres, clusterDir: string, log: (l: string) => void) {
  try {
    const { pg_ctl } = await import('@embedded-postgres/windows-x64')
    await promisify(execFile)(pg_ctl, ['stop', '-D', clusterDir, '-m', 'fast', '-w', '-t', '20'], {
      windowsHide: true,
    })
    ;(pg as unknown as { process?: unknown }).process = undefined
    log('[chas] database stopped')
  } catch (err) {
    log(`[chas] clean database stop failed, forcing it: ${(err as Error).message}`)
    await pg.stop()
  }
}

/* Every migration folder the database has not had, in name order, each in
   its own transaction - the way `prisma migrate deploy` applies them, without
   shipping the Prisma CLI and its schema engine to a school laptop.

   The record of what has been applied is its own small table rather than
   Prisma's _prisma_migrations: that one carries checksums and a lifecycle the
   CLI owns, and a hand-written imitation of it is a thing that half-works
   until the day somebody points the CLI at this database. */
const appliedThisLaunch = new Set<string>()

async function migrate(pg: EmbeddedPostgres, migrationsDir: string, log: (l: string) => void) {
  const client = pg.getPgClient('chas')
  await client.connect()
  try {
    await client.query(
      'CREATE TABLE IF NOT EXISTS "_chas_migrations" (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    )
    const applied: { rows: { name: string }[] } = await client.query(
      'SELECT name FROM "_chas_migrations"',
    )
    const done = new Set(applied.rows.map((r) => r.name))
    const pending = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(path.join(migrationsDir, d.name, 'migration.sql')))
      .map((d) => d.name)
      .sort()
      .filter((name) => !done.has(name))

    for (const name of pending) {
      const sql = readFileSync(path.join(migrationsDir, name, 'migration.sql'), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO "_chas_migrations" (name) VALUES ($1)', [name])
        await client.query('COMMIT')
        appliedThisLaunch.add(name)
        log(`[chas] migration applied: ${name}`)
      } catch (err) {
        await client.query('ROLLBACK')
        throw new Error(`Migration ${name} failed: ${(err as Error).message}`)
      }
    }
  } finally {
    await client.end()
  }
}

/* --- First launch ---------------------------------------------------------- */

async function bootstrap(log: (l: string) => void) {
  /* Imported here: db.ts imports env.ts, which validates process.env the
     moment it loads, and the environment is only complete once Postgres is
     up and its port known. */
  const { db } = await import('./src/db.js')

  if ((await db.school.count()) > 0) return

  const argon = { memoryCost: 19456, timeCost: 2, parallelism: 1 }
  const [headHash, nurseHash] = await Promise.all([
    argonHash(FIRST_ACCOUNTS.head.password, argon),
    argonHash(FIRST_ACCOUNTS.nurse.password, argon),
  ])

  /* One transaction: a launch killed halfway through leaves either a school
     with everything under it, or nothing - and the next launch starts over. */
  await db.$transaction(async (tx) => {
    const school = await tx.school.create({
      data: {
        name: SCHOOL.name,
        depedId: SCHOOL.id || null,
        district: SCHOOL.district,
        division: SCHOOL.division,
        region: SCHOOL.region,
        schoolYear: SCHOOL.schoolYear,
      },
    })

    const gradeIdByLevel = new Map<number, string>()
    for (const level of [...new Set(SECTIONS.map((s) => s.grade))].sort((a, b) => a - b)) {
      const row = await tx.gradeLevel.create({
        data: { schoolId: school.id, name: `Grade ${level}`, level },
      })
      gradeIdByLevel.set(level, row.id)
    }

    for (const s of SECTIONS) {
      const gradeLevelId = gradeIdByLevel.get(s.grade)
      if (!gradeLevelId) continue
      await tx.section.create({ data: { schoolId: school.id, name: s.name, gradeLevelId, adviser: s.adviser } })
    }

    await tx.user.create({
      data: {
        schoolId: school.id,
        username: FIRST_ACCOUNTS.head.username,
        fullName: ADMIN.name,
        role: 'ADMIN',
        passwordHash: headHash,
        /* Published in the README, so replaced at the first sign-in. */
        mustChangePassword: true,
      },
    })
    await tx.user.create({
      data: {
        schoolId: school.id,
        username: FIRST_ACCOUNTS.nurse.username,
        fullName: NURSE.name,
        role: 'NURSE',
        passwordHash: nurseHash,
        mustChangePassword: true,
      },
    })
  })

  log('[chas] first launch: school, sections and the head and nurse accounts created')
}

/* Sample learners, in an installer built with `npm run dist:samples` only.

   The build stamps __CHAS_SAMPLES__ in (scripts/build-desktop-server.mjs);
   an ordinary `npm run dist` leaves it out and this does nothing. Where it is
   in, the 25 learners in samples.ts are added once per machine, and only to a
   database that holds no learners except samples (LRN 999999...) - a fresh
   install, or one where samples were added by hand. Real records are never
   mixed with them. The marker file keeps samples that were deleted from
   coming back on the next launch. */
declare const __CHAS_SAMPLES__: boolean | undefined
const WITH_SAMPLES = typeof __CHAS_SAMPLES__ !== 'undefined' && __CHAS_SAMPLES__

async function addSamplesOnFirstLaunch(dataDir: string, log: (l: string) => void) {
  if (!WITH_SAMPLES) return
  const marker = path.join(dataDir, 'samples-added')
  if (existsSync(marker)) return
  const { db } = await import('./src/db.js')
  const real = await db.learner.count({ where: { NOT: { lrn: { startsWith: SAMPLE_LRN_PREFIX } } } })
  if (real === 0) {
    const added = await addSampleLearners(() => {})
    log(`[chas] sample data: ${added} sample learners added`)
  } else {
    log(`[chas] sample data: not added, the database already has ${real} learners`)
  }
  writeFileSync(marker, new Date().toISOString())
}

/* An upgrade from 0.2.0 or earlier. The first sign-in for the head changed
   from a.bantolo / chas-head-2026 to admin / admin12345678, and a school that
   installs the new release over the old one should be able to use the new
   one. But only where the old one was never changed: a head who chose her own
   password keeps it and her username, because silently replacing a password
   somebody set is how a school gets locked out of its own records.

   So: the old default username, still ADMIN, still active, still opening with
   the old default password, and no account already called `admin`. Anything
   else and nothing is touched. */
async function adoptNewDefaultHead(log: (l: string) => void) {
  const { db } = await import('./src/db.js')
  const old = await db.user.findFirst({
    where: { username: OLD_DEFAULT_HEAD.username, role: 'ADMIN', disabledAt: null, deletedAt: null },
    select: { id: true, schoolId: true, passwordHash: true },
  })
  if (!old) return
  if (!(await argonVerify(old.passwordHash, OLD_DEFAULT_HEAD.password).catch(() => false))) return
  const taken = await db.user.findFirst({
    where: { schoolId: old.schoolId, username: FIRST_ACCOUNTS.head.username },
    select: { id: true },
  })
  if (taken) return

  const passwordHash = await argonHash(FIRST_ACCOUNTS.head.password, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  })
  await db.user.update({
    where: { id: old.id },
    data: { username: FIRST_ACCOUNTS.head.username, passwordHash, mustChangePassword: true },
  })
  log(`[chas] upgrade: the unchanged default head account is now "${FIRST_ACCOUNTS.head.username}"`)
}

/* An upgrade from 0.7.0 or earlier, or a restored backup made by one: the
   flag column has just been added, false for everybody. Any account that
   still opens with a published default password - whatever it is called
   now - is flagged, so its next sign-in asks for a new one. Runs once per
   database, in the launch that added the column; from then on every place
   that sets a password somebody else chose sets the flag itself. */
async function flagDefaultPasswords(log: (l: string) => void) {
  if (!appliedThisLaunch.has('9k_must_change_password')) return
  const { db } = await import('./src/db.js')
  const users = await db.user.findMany({
    where: { deletedAt: null, mustChangePassword: false },
    select: { id: true, username: true, passwordHash: true },
  })
  const defaults = [FIRST_ACCOUNTS.head.password, FIRST_ACCOUNTS.nurse.password]
  for (const u of users) {
    for (const password of defaults) {
      if (await argonVerify(u.passwordHash, password).catch(() => false)) {
        await db.user.update({ where: { id: u.id }, data: { mustChangePassword: true } })
        log(`[chas] upgrade: "${u.username}" still has a default password and must set a new one`)
        break
      }
    }
  }
}

/* --- Backup and restore -----------------------------------------------------

   A backup is a COLD COPY of the database cluster: PostgreSQL is stopped
   cleanly, its data folder is copied as it is, and it is started again. That
   is a complete backup by PostgreSQL's own definition - every account, every
   measurement and every revision and audit line - and it needs no pg_dump,
   which the bundled PostgreSQL does not carry. The cost is a few seconds in
   which the app cannot save, which the Backup screen covers with a wait.

   A backup folder holds:
     pgdata/            the cluster, as it was when stopped
     chas-backup.json   what it is, when it was made, and how much is in it
     key.json           the cluster's own Postgres password, without which the
                        copied cluster cannot be opened

   A restore cannot happen under a running app: the API holds connections to
   the cluster being replaced. So restoreFrom() stops the database, moves the
   current cluster aside (never deletes it), copies the backup in, writes a
   marker, and the caller restarts the app. The next launch sees the marker,
   opens the restored cluster, and - if that fails - puts the previous one
   back, so a bad backup cannot leave the school with no records at all. */

const MANIFEST = 'chas-backup.json'
const KEY_FILE = 'key.json'
const PENDING = 'restore-pending.json'
const OUTCOME = 'last-restore.json'

function stampOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

/** Files PostgreSQL writes only while running; copying them would make the
    restored cluster believe another server still holds it. */
const RUNTIME_FILE = /[\\/]postmaster\.(pid|opts)$/

/** Read and check a backup folder. Throws a sentence the head can act on. */
export function readBackup(folder: string, clusterDir: string): BackupManifest {
  const manifestFile = path.join(folder, MANIFEST)
  if (!existsSync(manifestFile)) {
    throw new Error('That folder is not a CHAS backup. Choose the folder named CHAS-backup-… itself.')
  }
  let manifest: BackupManifest
  try {
    manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
  } catch {
    throw new Error('That backup is damaged and cannot be used.')
  }
  if (manifest.app !== 'CHAS' || manifest.format !== 1) {
    throw new Error('That backup was made by a different program or version.')
  }
  if (!existsSync(path.join(folder, 'pgdata', 'PG_VERSION')) || !existsSync(path.join(folder, KEY_FILE))) {
    throw new Error('That backup is incomplete and cannot be used.')
  }
  const current = existsSync(path.join(clusterDir, 'PG_VERSION'))
    ? readFileSync(path.join(clusterDir, 'PG_VERSION'), 'utf8').trim()
    : manifest.pgVersion
  if (manifest.pgVersion !== current) {
    throw new Error(
      `That backup holds a version ${manifest.pgVersion} database and this CHAS runs version ${current}. It cannot be opened here.`,
    )
  }
  return manifest
}

/** A new folder name in `parent` for a backup made at `d`. */
function freeFolder(parent: string, d: Date): string {
  let folder = path.join(parent, `CHAS-backup-${stampOf(d)}`)
  for (let i = 2; existsSync(folder); i++) folder = path.join(parent, `CHAS-backup-${stampOf(d)}-${i}`)
  return folder
}

/** Copy the cluster into `folder`. The database must be stopped. */
function writeBackup(clusterDir: string, folder: string, manifest: BackupManifest, pgPassword: string) {
  mkdirSync(folder, { recursive: true })
  cpSync(clusterDir, path.join(folder, 'pgdata'), {
    recursive: true,
    filter: (src) => !RUNTIME_FILE.test(src),
  })
  writeFileSync(path.join(folder, KEY_FILE), JSON.stringify({ pgPassword }))
  /* Written last: a folder without it is a copy that did not finish, and
     readBackup() refuses it. */
  writeFileSync(path.join(folder, MANIFEST), JSON.stringify(manifest, null, 2))
}

/* --- Automatic backups ------------------------------------------------------

   Made each time CHAS closes, while the database is being stopped anyway, so
   nobody waits for it. The same format as a backup made by hand, so Restore
   opens one the same way. Kept in backups/ beside the cluster, in AppData:
   not Documents, which OneDrive may sync, because these are unencrypted
   health records and must not reach a cloud folder nobody chose.

   One backup per day is kept - a later close on the same day replaces the
   earlier one - for the last seven days that had one. A copy cut short (the
   computer switched off part-way through) has no chas-backup.json; the next
   prune removes it.

   A session that ended without closing CHAS (a power cut, a forced
   shutdown) leaves the session marker behind, and the next launch makes the
   backup that the close never did. */

const AUTO_DIR = 'backups'
const AUTO_KEEP_DAYS = 7
const SESSION_MARKER = 'session-open'
const CLOSING_MARKER = 'closing.json'

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/* CHAS opened again while the last one is still making its backup, after
   its window has gone. Electron's one-instance lock does not cover that
   moment, and a database started under the copy would make it worthless -
   so the new one waits on its starting screen until the old one is done. A
   marker left by a process that is no longer running is simply stale. */
async function waitForPreviousClose(dataDir: string, log: (l: string) => void) {
  const file = path.join(dataDir, CLOSING_MARKER)
  const deadline = Date.now() + 60_000
  let said = false
  while (existsSync(file)) {
    let pid = 0
    try {
      pid = Number(JSON.parse(readFileSync(file, 'utf8')).pid) || 0
    } catch {
      /* Unreadable: treat as stale. */
    }
    if (!pid || pid === process.pid || !isRunning(pid) || Date.now() > deadline) {
      rmSync(file, { force: true })
      return
    }
    if (!said) log('[chas] waiting for the previous CHAS to finish closing')
    said = true
    await new Promise((r) => setTimeout(r, 250))
  }
}
const BACKUP_NAME = /^CHAS-backup-(\d{4}-\d{2}-\d{2})-\d{4}(-\d+)?$/

/** Complete automatic backups, newest first. Ordered by when each was made,
    not by name: a -2 suffix only means the plain name was taken at the time. */
function automaticBackups(autoDir: string): string[] {
  if (!existsSync(autoDir)) return []
  const made = (name: string) => {
    try {
      return Date.parse(JSON.parse(readFileSync(path.join(autoDir, name, MANIFEST), 'utf8')).createdAt) || 0
    } catch {
      return 0
    }
  }
  return readdirSync(autoDir)
    .filter((name) => BACKUP_NAME.test(name) && existsSync(path.join(autoDir, name, MANIFEST)))
    .map((name) => ({ name, at: made(name) }))
    .sort((a, b) => b.at - a.at)
    .map((b) => b.name)
}

function pruneAutomatic(autoDir: string) {
  for (const name of readdirSync(autoDir)) {
    if (BACKUP_NAME.test(name) && !existsSync(path.join(autoDir, name, MANIFEST))) {
      rmSync(path.join(autoDir, name), { recursive: true, force: true })
    }
  }
  const days = new Set<string>()
  for (const name of automaticBackups(autoDir)) {
    const day = BACKUP_NAME.exec(name)![1]
    if (days.has(day) || days.size >= AUTO_KEEP_DAYS) {
      rmSync(path.join(autoDir, name), { recursive: true, force: true })
    } else {
      days.add(day)
    }
  }
}

/* A restore left half-done - by the marker - is finished or undone here,
   before the database starts. Returns the cluster to fall back to if the
   restored one will not open. */
function pendingRestore(dataDir: string): { previous: string; previousSettings: string; manifest: BackupManifest; from: string } | null {
  const file = path.join(dataDir, PENDING)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    rmSync(file, { force: true })
    return null
  }
}

/* --- The API --------------------------------------------------------------- */

async function waitForApi(url: string) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/health`)
      if (res.ok) return
    } catch {
      /* Not listening yet. */
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error('CHAS could not start.')
}

export async function startDesktop(opts: DesktopOptions): Promise<Desktop> {
  const { dataDir, appDir, migrationsDir, log } = opts
  mkdirSync(dataDir, { recursive: true })
  await waitForPreviousClose(dataDir, log)

  const clusterDir = path.join(dataDir, 'pgdata')
  const settingsFile = path.join(dataDir, 'settings.json')
  const autoDir = path.join(dataDir, AUTO_DIR)
  const sessionMarker = path.join(dataDir, SESSION_MARKER)
  const closedUncleanly = existsSync(sessionMarker)
  let settings = await loadSettings(dataDir)

  /* Start the cluster, make sure the chas database is there, and bring its
     tables up to this version. `expectSchool` is set after a restore: a
     restored cluster with no school in it is not the backup it claimed to be. */
  async function open(expectSchool: boolean): Promise<EmbeddedPostgres> {
    const cluster = await startPostgres(dataDir, settings, log)
    try {
      await useScram(cluster, clusterDir, settings.pgPassword, log)
      /* createDatabase fails on an existing database; the catalogue says
         whether it is there. */
      const admin = cluster.getPgClient('postgres')
      await admin.connect()
      const exists = (await admin.query("SELECT 1 FROM pg_database WHERE datname = 'chas'")).rowCount
      await admin.end()
      if (!exists) {
        if (expectSchool) throw new Error('That backup has no CHAS records in it.')
        await cluster.createDatabase('chas')
      }
      await migrate(cluster, migrationsDir, log)
      if (expectSchool) {
        const client = cluster.getPgClient('chas')
        await client.connect()
        const n = Number((await client.query('SELECT count(*) AS n FROM "schools"')).rows[0].n)
        await client.end()
        if (n < 1) throw new Error('That backup has no school records in it.')
      }
      return cluster
    } catch (err) {
      await stopPostgres(cluster, clusterDir, log).catch(() => {})
      throw err
    }
  }

  let pg: EmbeddedPostgres
  const pending = pendingRestore(dataDir)
  if (!pending) {
    pg = await open(false)
  } else {
    const outcome: RestoreOutcome = {
      ok: true,
      at: new Date().toISOString(),
      from: pending.from,
      backupDate: pending.manifest?.createdAt ?? null,
    }
    try {
      pg = await open(true)
      log(`[chas] restore finished: opened the backup from ${pending.from}`)
    } catch (err) {
      /* Put the records from before the restore back exactly where they
         were, and open those instead. embedded-postgres rejects a failed
         start with no error at all, hence the fallback sentence. */
      const why = err instanceof Error ? err.message : 'the database in the backup would not start'
      log(`[chas] the restored copy would not open, putting the previous records back: ${why}`)
      rmSync(clusterDir, { recursive: true, force: true })
      renameSync(pending.previous, clusterDir)
      if (existsSync(pending.previousSettings)) copyFileSync(pending.previousSettings, settingsFile)
      settings = await loadSettings(dataDir)
      pg = await open(false)
      outcome.ok = false
      outcome.message = why
    }
    writeFileSync(path.join(dataDir, OUTCOME), JSON.stringify(outcome, null, 2))
    rmSync(path.join(dataDir, PENDING), { force: true })
  }

  try {

    const url = `http://127.0.0.1:${settings.apiPort}`
    Object.assign(process.env, {
      DATABASE_URL: `postgresql://chas:${settings.pgPassword}@127.0.0.1:${settings.pgPort}/chas?schema=public`,
      HOST: '127.0.0.1',
      PORT: String(settings.apiPort),
      NODE_ENV: 'production',
      SESSION_SECRET: settings.sessionSecret,
      APP_DIR: appDir,
      CORS_ORIGIN: url,
    })

    await bootstrap(log)
    await adoptNewDefaultHead(log)
    await flagDefaultPasswords(log)
    await addSamplesOnFirstLaunch(dataDir, log)
    await import('./src/index.js')
    await waitForApi(url)
    log(`[chas] ready at ${url}`)

    const { db } = await import('./src/db.js')

    /* Close the API's connections before the cluster stops, so nothing is
       mid-query when it goes. Prisma reconnects by itself on the next query
       once the cluster is back. */
    async function pause() {
      await db.$disconnect().catch(() => {})
      await stopPostgres(pg, clusterDir, log)
    }

    /** What a backup made now holds. Read while the database is running. */
    async function manifestNow(): Promise<BackupManifest> {
      const [learners, measurements, school] = await Promise.all([
        db.learner.count(),
        db.measurement.count(),
        db.school.findFirst({ select: { name: true } }),
      ])
      return {
        app: 'CHAS',
        format: 1,
        createdAt: new Date().toISOString(),
        pgVersion: readFileSync(path.join(clusterDir, 'PG_VERSION'), 'utf8').trim(),
        school: school?.name ?? null,
        learners,
        measurements,
      }
    }

    /** Write today's automatic backup. The database must be stopped. */
    function saveAutomatic(manifest: BackupManifest): boolean {
      const folder = freeFolder(autoDir, new Date(manifest.createdAt))
      try {
        writeBackup(clusterDir, folder, manifest, settings.pgPassword)
        pruneAutomatic(autoDir)
        log(`[chas] automatic backup written to ${folder}`)
        return true
      } catch (err) {
        rmSync(folder, { recursive: true, force: true })
        log(`[chas] automatic backup failed: ${(err as Error).message}`)
        return false
      }
    }

    if (closedUncleanly) {
      log('[chas] CHAS was not closed properly last time; making the automatic backup now')
      try {
        const manifest = await manifestNow()
        await pause()
        saveAutomatic(manifest)
      } catch (err) {
        log(`[chas] automatic backup failed: ${(err as Error).message}`)
      } finally {
        await pg.start()
      }
    }
    writeFileSync(sessionMarker, new Date().toISOString())

    return {
      url,
      automaticFolder: autoDir,

      stop: async () => {
        const closing = path.join(dataDir, CLOSING_MARKER)
        writeFileSync(closing, JSON.stringify({ pid: process.pid }))
        try {
          const manifest = await manifestNow().catch((err) => {
            log(`[chas] automatic backup skipped: ${(err as Error).message}`)
            return null
          })
          await pause()
          /* The marker stays when the backup failed, so the next launch
             tries again. */
          if (manifest && saveAutomatic(manifest)) rmSync(sessionMarker, { force: true })
        } finally {
          rmSync(closing, { force: true })
        }
      },

      lastAutomatic: () => {
        const [newest] = automaticBackups(autoDir)
        if (!newest) return null
        try {
          return JSON.parse(readFileSync(path.join(autoDir, newest, MANIFEST), 'utf8')) as BackupManifest
        } catch {
          return null
        }
      },

      lastRestore: () => {
        const file = path.join(dataDir, OUTCOME)
        if (!existsSync(file)) return null
        try {
          return JSON.parse(readFileSync(file, 'utf8')) as RestoreOutcome
        } catch {
          return null
        }
      },

      backupTo: async (parent) => {
        if (!existsSync(parent)) throw new Error('That folder is not there any more.')
        const manifest = await manifestNow()
        const folder = freeFolder(parent, new Date(manifest.createdAt))
        const { learners, measurements } = manifest

        await pause()
        try {
          writeBackup(clusterDir, folder, manifest, settings.pgPassword)
          log(`[chas] backup written to ${folder}`)
        } catch (err) {
          rmSync(folder, { recursive: true, force: true })
          throw new Error('The backup could not be saved there. Check that the USB drive is plugged in and has free space.')
        } finally {
          await pg.start()
        }
        return { folder, createdAt: manifest.createdAt, learners, measurements }
      },

      restoreFrom: async (folder) => {
        const manifest = readBackup(folder, clusterDir)
        const key = JSON.parse(readFileSync(path.join(folder, KEY_FILE), 'utf8')) as { pgPassword?: string }
        if (!key.pgPassword) throw new Error('That backup is incomplete and cannot be used.')

        /* One safety copy is kept, the newest. Older ones would otherwise
           pile up a whole database per restore. */
        for (const d of readdirSync(dataDir)) {
          if (/^(pgdata|settings)-before-restore-/.test(d)) rmSync(path.join(dataDir, d), { recursive: true, force: true })
        }
        const stamp = stampOf(new Date())
        const previous = path.join(dataDir, `pgdata-before-restore-${stamp}`)
        const previousSettings = path.join(dataDir, `settings-before-restore-${stamp}.json`)

        await pause()
        try {
          copyFileSync(settingsFile, previousSettings)
          renameSync(clusterDir, previous)
          cpSync(path.join(folder, 'pgdata'), clusterDir, {
            recursive: true,
            filter: (src) => !RUNTIME_FILE.test(src),
          })
          writeFileSync(settingsFile, JSON.stringify({ ...settings, pgPassword: key.pgPassword }, null, 2))
          writeFileSync(
            path.join(dataDir, PENDING),
            JSON.stringify({ previous, previousSettings, manifest, from: folder }, null, 2),
          )
          log(`[chas] restore prepared from ${folder}; restarting to open it`)
        } catch (err) {
          /* Nothing is half-replaced: put the current records back and keep
             running on them. */
          if (existsSync(previous)) {
            rmSync(clusterDir, { recursive: true, force: true })
            renameSync(previous, clusterDir)
          }
          if (existsSync(previousSettings)) copyFileSync(previousSettings, settingsFile)
          await pg.start()
          throw new Error('The backup could not be restored, so nothing was changed.')
        }
      },
    }
  } catch (err) {
    /* Never leave a postgres.exe running behind a window that failed to
       open: the next launch would find the cluster locked. */
    await stopPostgres(pg, clusterDir, log).catch(() => {})
    throw err
  }
}
