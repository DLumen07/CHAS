/* Seed the database from the roster the app already generates.

   It imports `src/data/mock.ts` from the front-end rather than defining its
   own learners. That module is a deterministic generator - a fixed PRNG seed,
   heights and weights inverted out of the real WHO tables - so the database
   comes up holding exactly the roster every screenshot, demo script and
   README figure in this repo was written against. A second generator here
   would drift from that within a week, and then the numbers in DEMO-SCRIPT.md
   would stop matching the app.

   IDEMPOTENT. Every write is an upsert on a natural key (LRN for learners,
   username for users, name for sections), so running it twice changes
   nothing. That matters because `prisma migrate dev` runs it automatically
   and a seed that duplicated its roster on the second run would be useless.

   IT DOES NOT SEED MEASUREMENTS BY DEFAULT. The generated roster carries
   heights and weights for ~78% of learners, and loading those would put 129
   fabricated clinical records into a database that is about to be deployed -
   indistinguishable, once there, from real ones. Pass --with-measurements to
   load them for a demo. The learners themselves are fabricated too, but a
   roster is replaced wholesale by an import; measurements accumulate. */

/* The seed reads .env itself.

   `prisma.config.ts` imports dotenv, which covers every command the Prisma
   CLI runs - migrate, studio, db execute. This file is not one of those: it
   is run directly by tsx (see the db:seed script), so nothing had put
   DATABASE_URL into the environment by the time PrismaClient looked for it,
   and the seed failed on its first query with "Environment variable not
   found". Loading it here rather than depending on the caller's shell means
   `npm run db:seed` works the same way from any terminal. */
import 'dotenv/config'
import { PrismaClient, type ImmunizationStatus, type Sex } from '@prisma/client'
import { hash as argonHash } from '@node-rs/argon2'
import { LEARNERS, SECTIONS, ADMIN, NURSE } from '../../src/data/mock.js'
import { SCHOOL } from '../../src/data/school.js'

const db = new PrismaClient()

const withMeasurements = process.argv.includes('--with-measurements')

/* The development passphrase.

   One value for every seeded account, printed at the end, and deliberately
   long enough to be unusable as a "temporary" production password by
   accident. The seed refuses to run against NODE_ENV=production below unless
   SEED_PASSWORD is set explicitly, so this string can never end up guarding a
   real school's records because somebody forgot to change it. */
const DEV_PASSWORD = process.env.SEED_PASSWORD ?? 'chas-dev-passphrase-2026'

/* The nurse signs in as the POST rather than as the person.
 *
 * Every other account here is named after whoever holds it, which is right
 * for a head: that is a person, and the audit trail
 * names them. The nurse's station is the one a school treats as a desk - the
 * post outlives the person sitting at it, and a username derived from a name
 * means the account has to be recreated the June a new nurse arrives.
 *
 * Her passphrase is held apart from DEV_PASSWORD for the same reason both are
 * printed at the end of this script: they are development constants in
 * version control, known to everyone who has read this file, and are meant to
 * be changed from the Roles screen before this database is reachable from
 * anywhere. SEED_PASSWORD overrides both. */
const NURSE_USERNAME = 's.nurse'
const NURSE_PASSWORD = process.env.SEED_PASSWORD ?? 'nurse12345678'

/** "Mrs. C. Delos Reyes" -> "c.delosreyes", the shape DepEd accounts use. */
function usernameFor(fullName: string): string {
  const rest = fullName
    .trim()
    .replace(/^(Mrs|Mr|Ms|Gng|Bb|G)\.?\s+/i, '')
    .trim()
  const initial = rest.match(/^([A-Za-z])\.?\s+/)
  const given = initial ? initial[1] : (rest.split(/\s+/)[0] ?? '')
  const surname = (initial ? rest.slice(initial[0].length) : rest).trim()
  return `${given[0] ?? ''}.${surname.replace(/\s+/g, '')}`.toLowerCase()
}

const IMMUNIZATION: Record<string, ImmunizationStatus> = {
  complete: 'COMPLETE',
  incomplete: 'INCOMPLETE',
  none: 'NONE',
}

async function main() {
  if (process.env.NODE_ENV === 'production' && !process.env.SEED_PASSWORD) {
    console.error(
      '\n[chas] Refusing to seed a production database with the development passphrase.\n' +
        '       Set SEED_PASSWORD explicitly if you really mean to.\n',
    )
    process.exit(1)
  }

  console.log('[chas] seeding…')

  /* THE SEED IS IDEMPOTENT, and this lookup is what makes it so.

     It used to be an upsert on `where: { depedId: SCHOOL.id || '__unset__' }`,
     which could never match. A DepEd School ID is issued rather than invented,
     so `SCHOOL.id` is deliberately an empty string in data/school.ts, and the
     create below correctly stores that as NULL - meaning the sentinel was
     looked up against a column that never holds it. Every run therefore made
     a NEW school, with its own sections and its own head, and running the
     seed twice left two of everything and an admin account that could not see
     the roster because the roster belonged to the other school.

     So: match on the DepEd id when there is one, and on the school's name
     when there is not. The name is not globally unique and should not be a
     database constraint - two divisions can both have a "Central Elementary
     School" - but within one deployment's database it identifies the school
     this seed is for, which is all this lookup has to do. */
  const existing = await db.school.findFirst({
    where: SCHOOL.id ? { depedId: SCHOOL.id } : { name: SCHOOL.name },
    select: { id: true },
  })

  const school = await db.school.upsert({
    where: { id: existing?.id ?? '__none__' },
    create: {
      name: SCHOOL.name,
      /* A DepEd School ID is issued, not invented. Null rather than an empty
         string so the unique index does not collide across schools that both
         lack one. */
      depedId: SCHOOL.id || null,
      district: SCHOOL.district,
      division: SCHOOL.division,
      region: SCHOOL.region,
      schoolYear: SCHOOL.schoolYear,
    },
    update: { name: SCHOOL.name, schoolYear: SCHOOL.schoolYear },
  })

  /* Grade levels first, then the sections that hang off them - learners and
     enrolments both point at a section, and a section cannot exist
     outside a year.

     The grades come from the sections rather than from a hardcoded 1..6, so a
     mock roster that ever covers a different set of years seeds the years it
     actually uses. */
  const gradeIdByLevel = new Map<number, string>()
  for (const level of [...new Set(SECTIONS.map((s) => s.grade))].sort((a, b) => a - b)) {
    const name = `Grade ${level}`
    const row = await db.gradeLevel.upsert({
      where: { schoolId_level: { schoolId: school.id, level } },
      create: { schoolId: school.id, name, level },
      update: { name },
    })
    gradeIdByLevel.set(level, row.id)
  }
  console.log(`[chas]   ${gradeIdByLevel.size} grade levels`)

  const sectionByName = new Map<string, string>()
  for (const s of SECTIONS) {
    const gradeLevelId = gradeIdByLevel.get(s.grade)
    if (!gradeLevelId) continue
    const row = await db.section.upsert({
      where: { schoolId_name: { schoolId: school.id, name: s.name } },
      create: { schoolId: school.id, name: s.name, gradeLevelId, adviser: s.adviser },
      update: { gradeLevelId },
    })
    sectionByName.set(s.name, row.id)
  }
  console.log(`[chas]   ${SECTIONS.length} sections`)

  const passwordHash = await argonHash(DEV_PASSWORD, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  })

  /* TWO accounts: the head and the nurse - the only two posts CHAS has.

     The sections above are seeded because a section is a fact about the
     school's structure rather than a person.

     The NURSE is seeded beside the head rather than left to be created, and
     the reason is the same one that keeps the head here: a database with
     nobody in it cannot be signed into, and there is exactly one post at a
     school that the app is useless without on its first morning. A weigh-in
     produces flagged children the same afternoon, and the person a flagged
     child is sent to has to be able to sign in. Her passphrase is the same
     constant as the head's and is no more of a secret; both are meant to be
     changed before this database is reachable from anywhere. */
  /* `password` is carried only where it differs from DEV_PASSWORD, so the
     summary at the end can be read without anybody having to remember which
     account is the exception. */
  const accounts: { username: string; fullName: string; password?: string }[] = []

  const adminUsername = usernameFor(ADMIN.name)
  await db.user.upsert({
    where: { schoolId_username: { schoolId: school.id, username: adminUsername } },
    create: {
      schoolId: school.id,
      username: adminUsername,
      fullName: ADMIN.name,
      role: 'ADMIN',
      passwordHash,
    },
    update: { fullName: ADMIN.name, role: 'ADMIN' },
  })
  accounts.push({ username: adminUsername, fullName: `${ADMIN.name} (${ADMIN.title})` })

  const nurseUsername = NURSE_USERNAME
  const nursePasswordHash = await argonHash(NURSE_PASSWORD, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  })
  await db.user.upsert({
    where: { schoolId_username: { schoolId: school.id, username: nurseUsername } },
    create: {
      schoolId: school.id,
      username: nurseUsername,
      fullName: NURSE.name,
      role: 'NURSE',
      passwordHash: nursePasswordHash,
    },
    update: { fullName: NURSE.name, role: 'NURSE' },
  })
  accounts.push({
    username: nurseUsername,
    fullName: `${NURSE.name} (${NURSE.title})`,
    password: NURSE_PASSWORD,
  })

  console.log(`[chas]   ${accounts.length} accounts`)

  /* The learners. */
  let n = 0
  for (const l of LEARNERS) {
    const sectionId = sectionByName.get(l.section)
    if (!sectionId) continue
    await db.learner.upsert({
      where: { lrn: l.lrn },
      create: {
        schoolId: school.id,
        sectionId,
        lrn: l.lrn,
        lastName: l.lastName,
        firstName: l.firstName,
        middleName: l.middleName || null,
        sex: l.sex as Sex,
        birthDate: new Date(`${l.birthDate}T00:00:00.000Z`),
        stubId: l.stubId,
      },
      update: { sectionId, lastName: l.lastName, firstName: l.firstName },
    })
    n++
  }
  console.log(`[chas]   ${n} learners`)

  /* Immunization is a property of the roster rather than of a weigh-in, so it
     loads with the learners. Attributed to the head, because on paper the
     cards are held at the office. */
  const admin = await db.user.findFirstOrThrow({
    where: { schoolId: school.id, username: adminUsername },
  })
  const checkedOn = new Date('2026-06-15T00:00:00.000Z')
  let immunized = 0
  for (const l of LEARNERS) {
    const learner = await db.learner.findUnique({ where: { lrn: l.lrn }, select: { id: true } })
    if (!learner) continue
    await db.immunization.upsert({
      where: { learnerId_checkedOn: { learnerId: learner.id, checkedOn } },
      create: {
        learnerId: learner.id,
        status: IMMUNIZATION[l.immunization],
        checkedOn,
        recordedById: admin.id,
      },
      update: { status: IMMUNIZATION[l.immunization] },
    })
    immunized++
  }
  console.log(`[chas]   ${immunized} immunization records`)

  if (withMeasurements) {
    /* Attributed to the nurse, who does the weighing. Demo measurements have
       to carry SOME real user id, and she is the account that records them. */
    const nurse = await db.user.findFirstOrThrow({
      where: { schoolId: school.id, username: nurseUsername },
      select: { id: true },
    })

    let measured = 0
    for (const l of LEARNERS) {
      if (!l.measuredOn || l.heightCm == null || l.weightKg == null) continue
      const learner = await db.learner.findUnique({ where: { lrn: l.lrn }, select: { id: true } })
      if (!learner) continue
      const recordedById = nurse.id
      const measuredOn = new Date(`${l.measuredOn}T00:00:00.000Z`)
      await db.measurement.upsert({
        where: { learnerId_measuredOn: { learnerId: learner.id, measuredOn } },
        create: {
          learnerId: learner.id,
          heightCm: l.heightCm,
          weightKg: l.weightKg,
          measuredOn,
          recordedById,
        },
        update: { heightCm: l.heightCm, weightKg: l.weightKg },
      })
      measured++
    }
    console.log(`[chas]   ${measured} measurements (--with-measurements)`)
  } else {
    console.log('[chas]   no measurements (pass --with-measurements for demo data)')
  }

  console.log('\n[chas] Seeded. Accounts:\n')
  for (const a of accounts) {
    console.log(
      `         ${a.username.padEnd(16)} ${a.fullName}${a.password ? `  [${a.password}]` : ''}`,
    )
  }
  console.log(`
       Passphrase, unless one is shown in brackets: ${DEV_PASSWORD}`)
  console.log('       Change it before this database is reachable from anywhere.\n')
}

main()
  .catch((e) => {
    console.error('[chas] seed failed:', e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
