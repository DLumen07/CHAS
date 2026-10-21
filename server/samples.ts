/* Twenty-five sample learners - four or five per grade level - for
   demonstrating and testing CHAS.

   Used in two places:
     - `npm run seed:samples` (sample-learners.ts) adds them to the database
       on this computer;
     - an installer built with `npm run dist:samples` adds them on the first
       launch of a new database (see addSamplesOnFirstLaunch in desktop.ts).

   Safe to run twice: a learner whose LRN is already there is skipped.

   EVERY NAME, LRN, BIRTH DATE AND NUMBER HERE IS INVENTED. The LRNs start
   with 999999, which no DepEd-issued LRN does, so a sample can never be
   mistaken for a real child. Do not add them to a real school's records.

   The measurements are chosen so the dashboards have something to show,
   checked against the WHO 2007 reference the app uses. At the October
   weigh-in: Wasted (2), Severely Wasted, Overweight (2), Obese, Stunted (2),
   Severely Stunted and Tall, the rest Normal. One learner moves from Wasted
   in June to Normal in October. Each learner has two weigh-ins (June and
   October 2026), so the growth charts draw a line. */

import { FIRST_ACCOUNTS } from './desktop.js'

/** Every sample LRN starts with this; no DepEd-issued LRN does. */
export const SAMPLE_LRN_PREFIX = '999999'

type Sex = 'M' | 'F'

interface Sample {
  grade: number
  lrn: string
  lastName: string
  firstName: string
  middleName: string
  sex: Sex
  birthDate: string
  /** [height cm, weight kg] in June, then in October. */
  june: [number, number]
  october: [number, number]
  immunization: 'COMPLETE' | 'INCOMPLETE'
  condition?: { condition: string; status: 'ACTIVE' | 'RESOLVED' | 'RECURRING'; treatment?: string }
  healthNotes?: string
}

export const SAMPLES: Sample[] = [
  // Grade 1
  { grade: 1, lrn: '999999260101', lastName: 'Santos', firstName: 'Maria Clara', middleName: 'Reyes', sex: 'F', birthDate: '2020-03-14',
    june: [115.5, 20.4], october: [117, 21], immunization: 'COMPLETE' },
  { grade: 1, lrn: '999999260102', lastName: 'Dela Cruz', firstName: 'Jose Miguel', middleName: 'Aquino', sex: 'M', birthDate: '2019-11-02',
    june: [118.8, 18.4], october: [120, 18.6], immunization: 'INCOMPLETE' },
  { grade: 1, lrn: '999999260103', lastName: 'Reyes', firstName: 'Sofia', middleName: 'Ocampo', sex: 'F', birthDate: '2020-02-08',
    june: [118.1, 21.6], october: [119.5, 22.2], immunization: 'COMPLETE' },
  { grade: 1, lrn: '999999260104', lastName: 'Navarro', firstName: 'Gabriel', middleName: 'Lim', sex: 'M', birthDate: '2020-07-19',
    june: [113, 18], october: [114.9, 18.8], immunization: 'COMPLETE' },
  // Grade 2
  { grade: 2, lrn: '999999260201', lastName: 'Bautista', firstName: 'Paolo', middleName: 'Garcia', sex: 'M', birthDate: '2019-05-20',
    june: [121.5, 22.8], october: [123, 23.5], immunization: 'COMPLETE' },
  { grade: 2, lrn: '999999260202', lastName: 'Villanueva', firstName: 'Andrea Mae', middleName: 'Lopez', sex: 'F', birthDate: '2019-01-09',
    june: [122.6, 31.4], october: [124, 32.5], immunization: 'COMPLETE' },
  { grade: 2, lrn: '999999260203', lastName: 'Torres', firstName: 'Kyla', middleName: 'Fajardo', sex: 'F', birthDate: '2019-04-25',
    june: [124, 23], october: [126, 24.1], immunization: 'COMPLETE' },
  { grade: 2, lrn: '999999260204', lastName: 'Salazar', firstName: 'Emilio', middleName: 'Cruz', sex: 'M', birthDate: '2019-08-12',
    june: [116.6, 17.3], october: [118, 18.6], immunization: 'COMPLETE',
    healthNotes: 'Wasted in June. Normal at the October weigh-in.' },
  // Grade 3
  { grade: 3, lrn: '999999260301', lastName: 'Ramos', firstName: 'Christian', middleName: 'Navarro', sex: 'M', birthDate: '2018-02-17',
    june: [127, 19.6], october: [128, 19.4], immunization: 'INCOMPLETE',
    healthNotes: 'Often skips breakfast, per the mother. Refer to the feeding program.' },
  { grade: 3, lrn: '999999260302', lastName: 'Mendoza', firstName: 'Princess Joy', middleName: 'Castillo', sex: 'F', birthDate: '2018-06-30',
    june: [125.6, 24.9], october: [127, 25.5], immunization: 'COMPLETE',
    condition: { condition: 'Asthma', status: 'RECURRING', treatment: 'Salbutamol inhaler as needed' } },
  { grade: 3, lrn: '999999260303', lastName: 'Padilla', firstName: 'Trisha', middleName: 'Serrano', sex: 'F', birthDate: '2018-01-30',
    june: [127.9, 27.8], october: [129.9, 29.3], immunization: 'COMPLETE' },
  { grade: 3, lrn: '999999260304', lastName: 'Bernardo', firstName: 'Lorenzo', middleName: 'Yap', sex: 'M', birthDate: '2018-09-03',
    june: [138.7, 31.3], october: [140.3, 32.2], immunization: 'COMPLETE' },
  // Grade 4
  { grade: 4, lrn: '999999260401', lastName: 'Gonzales', firstName: 'Kristine', middleName: 'Flores', sex: 'F', birthDate: '2017-04-11',
    june: [119, 22], october: [120, 22.5], immunization: 'COMPLETE' },
  { grade: 4, lrn: '999999260402', lastName: 'Aquino', firstName: 'Mark Anthony', middleName: 'Torres', sex: 'M', birthDate: '2016-12-05',
    june: [132.4, 28.7], october: [134, 29.5], immunization: 'COMPLETE' },
  { grade: 4, lrn: '999999260403', lastName: 'Rivera', firstName: 'Clarisse', middleName: 'Diaz', sex: 'F', birthDate: '2017-03-16',
    june: [118.7, 21.5], october: [120.5, 22.6], immunization: 'INCOMPLETE' },
  { grade: 4, lrn: '999999260404', lastName: 'Alvarez', firstName: 'Nathaniel', middleName: 'Perez', sex: 'M', birthDate: '2017-07-07',
    june: [133.9, 29.3], october: [135.3, 30.4], immunization: 'COMPLETE',
    condition: { condition: 'Primary complex', status: 'RESOLVED', treatment: 'Completed six months of medication in 2025' } },
  // Grade 5
  { grade: 5, lrn: '999999260501', lastName: 'Fernandez', firstName: 'John Carlo', middleName: 'Domingo', sex: 'M', birthDate: '2016-01-22',
    june: [138.6, 55.2], october: [140, 57], immunization: 'COMPLETE',
    healthNotes: 'Family reports frequent soft drinks and snacks. Diet counselling advised.' },
  { grade: 5, lrn: '999999260502', lastName: 'Pascual', firstName: 'Angelica', middleName: 'Rivera', sex: 'F', birthDate: '2015-09-08',
    june: [140.5, 33.1], october: [142, 34], immunization: 'COMPLETE',
    condition: { condition: 'Allergy to shrimp', status: 'ACTIVE', treatment: 'Avoid shellfish; antihistamine if exposed' } },
  { grade: 5, lrn: '999999260503', lastName: 'Gutierrez', firstName: 'Sofia', middleName: 'Manalo', sex: 'F', birthDate: '2016-05-02',
    june: [144.3, 50.2], october: [145.9, 53.1], immunization: 'COMPLETE' },
  { grade: 5, lrn: '999999260504', lastName: 'Marasigan', firstName: 'Andres', middleName: 'Ocampo', sex: 'M', birthDate: '2016-02-14',
    june: [135.6, 29.3], october: [136.9, 30.4], immunization: 'COMPLETE' },
  // Grade 6
  { grade: 6, lrn: '999999260601', lastName: 'Morales', firstName: 'Bea Nicole', middleName: 'Santiago', sex: 'F', birthDate: '2014-10-27',
    june: [147.4, 38], october: [149, 39], immunization: 'COMPLETE' },
  { grade: 6, lrn: '999999260602', lastName: 'Castillo', firstName: 'Rafael', middleName: 'Mercado', sex: 'M', birthDate: '2015-03-03',
    june: [121.2, 23.5], october: [122, 24], immunization: 'INCOMPLETE' },
  { grade: 6, lrn: '999999260603', lastName: 'Salvador', firstName: 'Trisha Mae', middleName: 'Garcia', sex: 'F', birthDate: '2015-06-21',
    june: [145.1, 35.3], october: [147.3, 37.3], immunization: 'COMPLETE' },
  { grade: 6, lrn: '999999260604', lastName: 'Domingo', firstName: 'Miguel', middleName: 'Padilla', sex: 'M', birthDate: '2014-11-11',
    june: [144.4, 40.3], october: [145.9, 42.2], immunization: 'COMPLETE',
    condition: { condition: 'Myopia', status: 'ACTIVE', treatment: 'Prescription glasses; seat near the board' } },
  { grade: 6, lrn: '999999260605', lastName: 'Ocampo', firstName: 'Kyla', middleName: 'Bernardo', sex: 'F', birthDate: '2015-01-05',
    june: [140.9, 26.5], october: [142.4, 28.3], immunization: 'INCOMPLETE',
    healthNotes: 'Wasted at both weigh-ins. Gaining weight; refer to the feeding program.' },
]

const JUNE = '2026-06-15'
const OCTOBER = '2026-10-01'
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

/** The doses on a sample card, dated from the birth date the way a real
    card is. An INCOMPLETE card is missing its later doses. */
function dosesFor(s: Sample): { vaccine: string; dose: string; givenOn: Date }[] {
  const born = day(s.birthDate)
  const plus = (weeks: number) => new Date(born.getTime() + weeks * 7 * 86_400_000)
  const card = [
    { vaccine: 'BCG', dose: '1', givenOn: plus(0) },
    { vaccine: 'Hepatitis B', dose: '1', givenOn: plus(0) },
    { vaccine: 'Pentavalent (DPT-HepB-Hib)', dose: '1', givenOn: plus(6) },
    { vaccine: 'Pentavalent (DPT-HepB-Hib)', dose: '2', givenOn: plus(10) },
    { vaccine: 'Pentavalent (DPT-HepB-Hib)', dose: '3', givenOn: plus(14) },
    { vaccine: 'Oral Polio (OPV)', dose: '1', givenOn: plus(6) },
    { vaccine: 'Measles, Mumps, Rubella (MMR)', dose: '1', givenOn: plus(39) },
    { vaccine: 'Measles, Mumps, Rubella (MMR)', dose: '2', givenOn: plus(52) },
  ]
  return s.immunization === 'COMPLETE' ? card : card.slice(0, 4)
}

/** Add every sample learner not already in the database and return how
    many were added. The database must already be open (startDesktop). */
export async function addSampleLearners(log: (line: string) => void): Promise<number> {
  const { db } = await import('./src/db.js')

  const school = await db.school.findFirstOrThrow()
  const nurse =
    (await db.user.findFirst({ where: { schoolId: school.id, username: FIRST_ACCOUNTS.nurse.username } })) ??
    (await db.user.findFirstOrThrow({ where: { schoolId: school.id } }))
  const sections = await db.section.findMany({
    where: { schoolId: school.id },
    select: { id: true, gradeLevel: { select: { level: true } } },
  })

  let added = 0
  for (const s of SAMPLES) {
    if (await db.learner.findUnique({ where: { lrn: s.lrn } })) {
      log(`  skipped ${s.lastName}, ${s.firstName} (already there)`)
      continue
    }
    const section = sections.find((x) => x.gradeLevel.level === s.grade)
    if (!section) throw new Error(`This school has no Grade ${s.grade} section.`)

    /* The same stub id scheme the registration form uses: G3-0007. */
    const prefix = `G${s.grade}-`
    const last = await db.learner.findFirst({
      where: { schoolId: school.id, stubId: { startsWith: prefix } },
      orderBy: { stubId: 'desc' },
      select: { stubId: true },
    })
    const stubId = `${prefix}${String(last ? Number(last.stubId.slice(prefix.length)) + 1 : 1).padStart(4, '0')}`

    await db.$transaction(async (tx) => {
      const learner = await tx.learner.create({
        data: {
          schoolId: school.id,
          sectionId: section.id,
          lrn: s.lrn,
          lastName: s.lastName,
          firstName: s.firstName,
          middleName: s.middleName,
          sex: s.sex,
          birthDate: day(s.birthDate),
          healthNotes: s.healthNotes ?? null,
          stubId,
        },
      })
      await tx.enrolment.create({
        data: { learnerId: learner.id, schoolYear: school.schoolYear, sectionId: section.id, status: 'ENROLLED', recordedById: nurse.id },
      })
      if (s.condition) {
        await tx.healthCondition.create({
          data: {
            learnerId: learner.id,
            condition: s.condition.condition,
            status: s.condition.status,
            treatment: s.condition.treatment ?? null,
            recordedById: nurse.id,
          },
        })
      }
      await tx.vaccineDose.createMany({
        data: dosesFor(s).map((d) => ({ ...d, learnerId: learner.id, status: 'GIVEN' as const, recordedById: nurse.id })),
      })
      await tx.immunization.create({
        data: { learnerId: learner.id, status: s.immunization, checkedOn: day(JUNE), recordedById: nurse.id },
      })
      for (const [on, [heightCm, weightKg]] of [
        [JUNE, s.june],
        [OCTOBER, s.october],
      ] as const) {
        await tx.measurement.create({
          data: { learnerId: learner.id, heightCm, weightKg, measuredOn: day(on), recordedById: nurse.id },
        })
        /* The history entry the Weigh-in screen would have written, dated
           09:00 on the day of the weigh-in (01:00 UTC). */
        await tx.measurementRevision.create({
          data: {
            learnerId: learner.id,
            measuredOn: day(on),
            heightCm,
            weightKg,
            kind: 'RECORDED',
            recordedById: nurse.id,
            at: new Date(`${on}T01:00:00.000Z`),
          },
        })
      }
    })
    added++
    log(`  added   ${s.lastName}, ${s.firstName} - Grade ${s.grade}, stub ${stubId}`)
  }
  return added
}
