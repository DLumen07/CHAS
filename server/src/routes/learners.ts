/* The roster, and everything recorded against it.

   ONE ENDPOINT, NOT SIX. `GET /api/learners` returns each learner already
   merged with their newest measurement, newest immunization check and current
   slip. The client used to do that merge itself against a local file; doing it
   here instead means the browser makes one request on load rather than four
   and then joining them by hand.

   WHAT IS DELIBERATELY NOT COMPUTED HERE: the WHO bands. The server sends
   height, weight, birth date, sex and a date; `src/lib/nutrition.ts` on the
   client turns those into z-scores and bands, exactly as it does today. That
   keeps one implementation of the classification instead of two that must be
   kept in step - and the client's is the one that has been checked against
   WHO's published tables to 0.0005.

   For the same reason there is no `/api/summary`: every definition on the
   admin dashboard lives in `src/lib/summary.ts`, and rewriting them as SQL
   aggregates would create a second set that drifts. The client already holds
   the roster it needs to count. If the school ever grows past what is
   sensible to send whole, the aggregation moves here - and `summary.ts`
   becomes the spec it is implemented from, not a rival. */

import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db.js'
import { badRequest, conflict, notFound } from '../lib/errors.js'
import { h, ipOf } from '../lib/http.js'
import { actorOf, requireAuth } from '../auth/middleware.js'
import { learnerScope } from '../auth/session.js'
import { audit } from '../lib/audit.js'
import { IDENTITY_SELECT, schoolIdentity } from './school.js'

export const learnersRouter = Router()

learnersRouter.use(requireAuth)

/* Postgres DATE columns come back as Date objects pinned to UTC midnight.
   Formatting them with toISOString().slice(0,10) is correct; formatting them
   with any local-time method is how 2026-08-04 becomes 2026-08-03 for anyone
   west of Greenwich. The whole app speaks YYYY-MM-DD strings, so the
   conversion happens once, here. */
function isoDate(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

/* Prisma returns Decimal for @db.Decimal columns. Sending those straight to
   JSON produces `{"s":1,"e":2,"d":[128,5]}` rather than 128.5, so every one
   is converted explicitly. */
function num(d: { toString(): string } | null | undefined): number | null {
  return d == null ? null : Number(d.toString())
}

const IMMUNIZATION_OUT = { COMPLETE: 'complete', INCOMPLETE: 'incomplete', NONE: 'none' } as const
const SLIP_OUT = { NOT_PRINTED: 'not-printed', PRINTED: 'printed', ATTENDED: 'attended' } as const

/**
 * The roster this account may read, each learner merged with their latest
 * records.
 *
 * Scoping is `learnerScope`, never a school from the query string; there is
 * no parameter that widens it.
 */
learnersRouter.get(
  '/',
  h(async (req, res) => {
    const actor = actorOf(req)

    /* The year and the advisers ride along with the roster: every screen
       that prints "S.Y." or an adviser's name already waits for this
       response, and the head can change both. */
    const school = await db.school.findUnique({
      where: { id: actor.schoolId },
      select: {
        ...IDENTITY_SELECT,
        schoolYear: true,
        slipText: true,
        sections: {
          orderBy: [{ gradeLevel: { level: 'asc' } }, { name: 'asc' }],
          select: { name: true, adviser: true, gradeLevel: { select: { level: true, name: true } } },
        },
      },
    })
    if (!school) throw notFound('The school has not been set up yet.', 'NO_SCHOOL')

    const rows = await db.learner.findMany({
      where: { ...learnerScope(actor), archivedAt: null },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      include: {
        section: { select: { name: true, gradeLevel: { select: { level: true, name: true } } } },
        /* `take: 1` on a descending sort is the learner's newest measurement.
           Prisma emits this as a lateral join, so it stays one query for the
           whole roster rather than one per learner. */
        measurements: {
          orderBy: { measuredOn: 'desc' },
          take: 1,
          select: { heightCm: true, weightKg: true, measuredOn: true, note: true, createdAt: true },
        },
        immunizations: {
          orderBy: { checkedOn: 'desc' },
          take: 1,
          select: { status: true, checkedOn: true },
        },
        /* This school year's invitation only. */
        slips: {
          where: { schoolYear: school.schoolYear },
          select: {
            state: true,
            printedAt: true,
            attendedAt: true,
            /* The meeting this slip invited the parent to, so the slips
               page can list its history meeting by meeting. */
            meeting: { select: { date: true, time: true, venue: true } },
          },
        },
        absences: {
          orderBy: { measuredOn: 'desc' },
          take: 1,
          select: { measuredOn: true },
        },
      },
    })

    res.json({
      schoolYear: school.schoolYear,
      /* The school's details ride along too, so a change in School settings
         reaches the SF8 header and the slips on the next refresh. */
      school: schoolIdentity(school),
      /* The slip's wording, so the head and the nurse print the same letter.
         Null: the wording shipped with the app. */
      slipText: school.slipText ?? null,
      advisers: Object.fromEntries(school.sections.map((s) => [s.name, s.adviser ?? ''])),
      /* Every class the head has set up, in order, learners or not. The
         class filters list these, so a class added in School settings
         shows before anyone is enrolled in it. */
      classes: school.sections.map((s) => ({ name: s.name, gradeLevel: s.gradeLevel.level, gradeName: s.gradeLevel.name })),
      learners: rows.map((l) => {
        const m = l.measurements[0]
        const im = l.immunizations[0]
        const slip = l.slips[0]
        return {
          id: l.id,
          lrn: l.lrn,
          lastName: l.lastName,
          firstName: l.firstName,
          middleName: l.middleName ?? '',
          sex: l.sex,
          birthDate: isoDate(l.birthDate),
          section: l.section.name,
          /* The number, not the row. The client counts on an integer here and
             the grade level is where that integer now lives. */
          gradeLevel: l.section.gradeLevel.level,
          /* The year level as the school names it, for the SF8's Grade cell. */
          gradeName: l.section.gradeLevel.name,
          stubId: l.stubId,

          heightCm: num(m?.heightCm),
          weightKg: num(m?.weightKg),
          measuredOn: isoDate(m?.measuredOn),
          measurementNote: m?.note ?? '',
          /* The wall-clock instant the row was typed, which is what the
             activity feed orders by. Distinct from measuredOn - see the
             schema. */
          recordedAt: m?.createdAt?.toISOString() ?? null,

          /* No card on file yet reads as 'none', which is what it is - the
             three-value status exists precisely so this is not a null the
             client has to invent a meaning for. */
          immunization: im ? IMMUNIZATION_OUT[im.status] : 'none',
          immunizationCheckedOn: isoDate(im?.checkedOn),

          slip: slip ? SLIP_OUT[slip.state] : 'not-printed',
          printedAt: slip?.printedAt?.toISOString() ?? null,
          attendedAt: slip?.attendedAt?.toISOString() ?? null,
          slipMeeting: slip?.meeting
            ? { date: isoDate(slip.meeting.date), time: slip.meeting.time, venue: slip.meeting.venue }
            : null,

          absentOn: isoDate(l.absences[0]?.measuredOn),
        }
      }),
    })
  }),
)

/* --- What the registration dialog may offer -------------------------------

   The school year and the classes this account may enrol into. One request
   rather than two, because the dialog cannot draw its Current Enrolment
   section until it has both. Scoped to the actor's school.

   Registered BEFORE '/:id', or Express reads "options" as a learner id.
-------------------------------------------------------------------------- */

learnersRouter.get(
  '/options',
  h(async (req, res) => {
    const actor = actorOf(req)

    const school = await db.school.findUnique({
      where: { id: actor.schoolId },
      select: { schoolYear: true, name: true },
    })
    if (!school) throw notFound('The school has not been set up yet.', 'NO_SCHOOL')

    const sections = await db.section.findMany({
      where: { schoolId: actor.schoolId },
      orderBy: [{ gradeLevel: { level: 'asc' } }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        gradeLevel: { select: { id: true, name: true, level: true } },
      },
    })

    res.json({
      schoolYear: school.schoolYear,
      schoolName: school.name,
      /* Flattened on the way out. The grade level is a row in the database
         and an integer in this DTO, because that is what every caller has
         always been handed and none of them wants a nested object to reach
         through. `gradeName` rides alongside for the screens that print the
         year as the school writes it rather than as a number. */
      sections: sections.map((s) => ({
        id: s.id,
        name: s.name,
        gradeLevel: s.gradeLevel.level,
        gradeName: s.gradeLevel.name,
        gradeLevelId: s.gradeLevel.id,
      })),
    })
  }),
)

/* --- Former learners ------------------------------------------------------

   Everyone the school no longer has on the roster: those who completed the
   last grade, transferred out or dropped at a rollover, and anyone archived
   by hand. Their records are kept (see the rollover), and this is how a
   record is reached again to print it - for a Grade 6 graduate, the copy the
   school files or hands over.

   Each with the year they were last enrolled and how it ended, newest first.
   Registered BEFORE '/:id' for the same reason as '/options'.
-------------------------------------------------------------------------- */

learnersRouter.get(
  '/former',
  h(async (req, res) => {
    const actor = actorOf(req)
    const rows = await db.learner.findMany({
      where: { ...learnerScope(actor), archivedAt: { not: null } },
      orderBy: [{ archivedAt: 'desc' }, { lastName: 'asc' }, { firstName: 'asc' }],
      select: {
        id: true,
        lrn: true,
        lastName: true,
        firstName: true,
        middleName: true,
        nameExt: true,
        sex: true,
        birthDate: true,
        archivedAt: true,
        section: { select: { name: true, gradeLevel: { select: { name: true } } } },
        enrolments: {
          orderBy: { schoolYear: 'desc' },
          take: 1,
          select: {
            schoolYear: true,
            outcome: true,
            status: true,
            section: { select: { name: true, gradeLevel: { select: { name: true } } } },
          },
        },
      },
    })

    res.json({
      learners: rows.map((l) => {
        const e = l.enrolments[0]
        return {
          id: l.id,
          lrn: l.lrn,
          lastName: l.lastName,
          firstName: l.firstName,
          middleName: l.middleName ?? '',
          nameExt: l.nameExt ?? '',
          sex: l.sex,
          birthDate: isoDate(l.birthDate),
          archivedAt: l.archivedAt!.toISOString(),
          /* The class they were last in, which is the enrolment's; the
             learner's own section is the same unless they predate the
             enrolment table. */
          section: e?.section.name ?? l.section.name,
          gradeName: e?.section.gradeLevel.name ?? l.section.gradeLevel.name,
          schoolYear: e?.schoolYear ?? null,
          outcome: e?.outcome ?? null,
          status: e?.status ?? null,
        }
      }),
    })
  }),
)

/* --- Enrolling a learner --------------------------------------------------

   THE SECTION is checked against the actor's school; an id from another
   school reads as not found.

   THE SCHOOL YEAR IS NOT ACCEPTED FROM THE CLIENT EITHER. It is read off the
   school. A registration filed under a year nobody is in is a row that no
   report will ever find.

   THE LRN IS TYPED, NOT GENERATED. A Learner Reference Number is issued by
   DepEd and follows a child between schools; inventing one would put a number
   in the national column that belongs to nobody, or worse, to somebody else.
   The unique index is what stops the same child being enrolled twice under
   two spellings of a surname, and it only works if the number is the real one.

   THE STUB ID IS GENERATED, because it is ours: it is the barcode on an
   invitation slip and means nothing outside this school.
-------------------------------------------------------------------------- */

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date.')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00.000Z`)), 'Enter a valid date.')

/* Optional free text. Trimmed, and an empty string is the same answer as an
   absent field - a form that posts every box it drew would otherwise write a
   row of empty strings and call it a health history. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined))

const NewLearner = z.object({
  /* Twelve digits. Checked as a shape rather than against a checksum: DepEd
     publishes no check digit for the LRN, so a stricter rule here would be
     invented and would reject valid numbers. */
  lrn: z.string().trim().regex(/^\d{12}$/, 'The LRN must be 12 digits.'),
  lastName: z.string().trim().min(1, 'The surname is required.').max(80),
  firstName: z.string().trim().min(1, 'The first name is required.').max(80),
  middleName: optionalText(80),
  nameExt: optionalText(16),
  sex: z.enum(['M', 'F']),
  birthDate: isoDay,

  sectionId: z.string().cuid(),
  enrolmentStatus: z
    .enum(['ENROLLED', 'TRANSFERRED_IN', 'RETURNING', 'TRANSFERRED_OUT', 'DROPPED'])
    .default('ENROLLED'),

  /* --- The health history is optional -------------------------------------
     It is what the school knows TODAY. The immunization card is NOT
     optional: at least one row from it is required to register a learner.

     NO PARENT OR GUARDIAN. The app stopped collecting family contact details
     on 2026-10-15: nothing used them, and a mobile number nobody calls from
     here is personal data held for no purpose. A `guardian` field sent by an
     older client is dropped by the schema, not stored. */
  healthNotes: optionalText(2000),
  condition: z
    .object({
      condition: z.string().trim().min(1).max(200),
      status: z.enum(['ACTIVE', 'RESOLVED', 'RECURRING', 'UNKNOWN']).default('UNKNOWN'),
      treatment: optionalText(500),
      notes: optionalText(1000),
    })
    .optional(),

  doses: z
    .array(
      z.object({
        vaccine: z.string().trim().min(1).max(80),
        dose: z.string().trim().min(1).max(24),
        givenOn: isoDay.optional(),
        status: z.enum(['GIVEN', 'SCHEDULED', 'MISSED', 'UNKNOWN']).default('GIVEN'),
        remarks: optionalText(200),
      }),
    )
    .min(1, 'Add at least one vaccine from the immunization card.')
    .max(30),
})

/** The next free stub id for a section: `G3-0028`. */
async function nextStubId(schoolId: string, grade: number): Promise<string> {
  const prefix = `G${grade}-`
  const last = await db.learner.findFirst({
    where: { schoolId, stubId: { startsWith: prefix } },
    orderBy: { stubId: 'desc' },
    select: { stubId: true },
  })
  const n = last ? Number(last.stubId.slice(prefix.length)) + 1 : 1
  return `${prefix}${String(n).padStart(4, '0')}`
}

/** A YYYY-MM-DD string as UTC midnight. `new Date('2018-04-09')` is already
    UTC, but saying so explicitly is what stops a later refactor to
    `new Date(y, m, d)` quietly shifting every date a day west. */
function utcDay(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`)
}

learnersRouter.post(
  '/',
  h(async (req, res) => {
    const actor = actorOf(req)
    const parsed = NewLearner.safeParse(req.body)
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message ?? 'Check the learner.', 'INVALID_BODY')
    }
    const body = parsed.data

    const section = await db.section.findFirst({
      where: { id: body.sectionId, schoolId: actor.schoolId },
      select: { id: true, name: true, gradeLevel: { select: { level: true } } },
    })
    if (!section) throw notFound('That section is not in this school.', 'NO_SECTION')

    const school = await db.school.findUnique({
      where: { id: actor.schoolId },
      select: { schoolYear: true },
    })
    if (!school) throw notFound('The school has not been set up yet.', 'NO_SCHOOL')

    const clash = await db.learner.findUnique({ where: { lrn: body.lrn }, select: { id: true } })
    if (clash) {
      throw conflict(`LRN ${body.lrn} is already enrolled at this school.`, 'LRN_TAKEN')
    }

    const stubId = await nextStubId(actor.schoolId, section.gradeLevel.level)

    /* ONE TRANSACTION. A learner with no enrolment row, or a health history
       filed against a child whose creation then failed, is worse than a
       refused registration - the nurse would have to find out which half
       landed before she could safely type it again. */
    const learner = await db.$transaction(async (tx) => {
      const created = await tx.learner.create({
        data: {
          schoolId: actor.schoolId,
          sectionId: section.id,
          lrn: body.lrn,
          lastName: body.lastName,
          firstName: body.firstName,
          middleName: body.middleName ?? null,
          nameExt: body.nameExt ?? null,
          sex: body.sex,
          birthDate: utcDay(body.birthDate),
          healthNotes: body.healthNotes ?? null,
          stubId,
        },
        select: { id: true, lrn: true, stubId: true, lastName: true, firstName: true },
      })

      await tx.enrolment.create({
        data: {
          learnerId: created.id,
          schoolYear: school.schoolYear,
          sectionId: section.id,
          status: body.enrolmentStatus,
          recordedById: actor.id,
        },
      })

      if (body.condition) {
        await tx.healthCondition.create({
          data: {
            learnerId: created.id,
            condition: body.condition.condition,
            status: body.condition.status,
            treatment: body.condition.treatment ?? null,
            notes: body.condition.notes ?? null,
            recordedById: actor.id,
          },
        })
      }

      if (body.doses?.length) {
        await tx.vaccineDose.createMany({
          data: body.doses.map((d) => ({
            learnerId: created.id,
            vaccine: d.vaccine,
            dose: d.dose,
            givenOn: d.givenOn ? utcDay(d.givenOn) : null,
            status: d.status,
            remarks: d.remarks ?? null,
            recordedById: actor.id,
          })),
        })
      }

      return created
    })

    /* The audit detail carries ids and counts, never the name, the LRN, the
       birth date or a condition. See the note on the audit table: these are
       minors' records and a log is copied into tickets. */
    audit({
      actorId: actor.id,
      action: 'LEARNER_ENROLLED',
      targetType: 'learner',
      targetId: learner.id,
      detail: {
        sectionId: section.id,
        schoolYear: school.schoolYear,
        conditions: body.condition ? 1 : 0,
        doses: body.doses?.length ?? 0,
      },
      ipAddress: ipOf(req),
    })

    res.status(201).json({ learner })
  }),
)

/* --- Importing a class list -----------------------------------------------

   A spreadsheet of one class - the SF1 from LIS, or anything with the same
   columns - read in the browser and sent here as rows. Only what an SF1
   carries is accepted: the LRN, the names, sex and birth date. The class is
   chosen once for the whole file.

   NO IMMUNIZATION ROW IS REQUIRED HERE, unlike the one-at-a-time form. A
   class list has no vaccine column, and inventing a dose to satisfy the rule
   would put a record on the card that nobody copied from a card. These
   learners read as "none" until the nurse adds the card from the profile.

   AN LRN ALREADY ON FILE IS SKIPPED, NOT AN ERROR. The same list is often
   imported twice - once in June, again after late enrolees are added - and a
   second import should add the new names and leave the rest alone. A row that
   is not valid at all fails the whole request: the browser checks every row
   before it sends, so one arriving here broken is a bug, not a typo.

   ONE TRANSACTION. Either the whole class lands or none of it does.
-------------------------------------------------------------------------- */

const ImportRow = NewLearner.pick({
  lrn: true,
  lastName: true,
  firstName: true,
  middleName: true,
  nameExt: true,
  sex: true,
  birthDate: true,
})

const ImportLearners = z.object({
  sectionId: z.string().cuid(),
  learners: z.array(ImportRow).min(1, 'The file has no learners to import.').max(100),
})

learnersRouter.post(
  '/import',
  h(async (req, res) => {
    const actor = actorOf(req)
    const parsed = ImportLearners.safeParse(req.body)
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message ?? 'Check the file.', 'INVALID_BODY')
    }
    const body = parsed.data

    const lrns = body.learners.map((l) => l.lrn)
    if (new Set(lrns).size !== lrns.length) {
      throw badRequest('The same LRN appears twice in the file.', 'DUPLICATE_LRN')
    }

    const section = await db.section.findFirst({
      where: { id: body.sectionId, schoolId: actor.schoolId },
      select: { id: true, gradeLevel: { select: { level: true } } },
    })
    if (!section) throw notFound('That section is not in this school.', 'NO_SECTION')

    const school = await db.school.findUnique({
      where: { id: actor.schoolId },
      select: { schoolYear: true },
    })
    if (!school) throw notFound('The school has not been set up yet.', 'NO_SCHOOL')

    const taken = new Set(
      (
        await db.learner.findMany({ where: { lrn: { in: lrns } }, select: { lrn: true } })
      ).map((l) => l.lrn),
    )
    const fresh = body.learners.filter((l) => !taken.has(l.lrn))

    /* One read for the next stub, then counted up locally. Calling
       nextStubId per row inside the transaction would read the same "last"
       stub forty times over. */
    const first = await nextStubId(actor.schoolId, section.gradeLevel.level)
    const prefix = `G${section.gradeLevel.level}-`
    let n = Number(first.slice(prefix.length))

    await db.$transaction(
      async (tx) => {
        for (const l of fresh) {
          const created = await tx.learner.create({
            data: {
              schoolId: actor.schoolId,
              sectionId: section.id,
              lrn: l.lrn,
              lastName: l.lastName,
              firstName: l.firstName,
              middleName: l.middleName ?? null,
              nameExt: l.nameExt ?? null,
              sex: l.sex,
              birthDate: utcDay(l.birthDate),
              stubId: `${prefix}${String(n++).padStart(4, '0')}`,
            },
            select: { id: true },
          })
          await tx.enrolment.create({
            data: {
              learnerId: created.id,
              schoolYear: school.schoolYear,
              sectionId: section.id,
              status: 'ENROLLED',
              recordedById: actor.id,
            },
          })
        }
      },
      { timeout: 60_000 },
    )

    /* Counts only, as with a single enrolment. */
    audit({
      actorId: actor.id,
      action: 'LEARNERS_IMPORTED',
      targetType: 'section',
      targetId: section.id,
      detail: { schoolYear: school.schoolYear, added: fresh.length, skipped: taken.size },
      ipAddress: ipOf(req),
    })

    res.status(201).json({ added: fresh.length, skipped: [...taken] })
  }),
)

/** One learner's full history. The record dialog's "everything we have".

    THIS IS WHERE THE REGISTRATION DATA COMES BACK OUT. The health history,
    the immunization card and the enrolment history are read here and nowhere
    else: none of them belong in `GET /`, which returns all 182 learners on
    every page load and would be carrying three more joins per child so that
    one dialog can show them one at a time. */
learnersRouter.get(
  '/:id',
  h(async (req, res) => {
    const actor = actorOf(req)
    const id = z.string().min(1).safeParse(req.params.id)
    if (!id.success) throw badRequest('That learner was not found.', 'INVALID_ID')

    const l = await db.learner.findFirst({
      /* Scope is in the WHERE, not checked after the fetch. A findUnique
         followed by an ownership check reads the row first, and the timing
         difference between "not found" and "not yours" is itself an oracle. */
      where: { id: id.data, ...learnerScope(actor) },
      include: {
        section: { select: { name: true, gradeLevel: { select: { level: true, name: true } } } },
        measurements: {
          orderBy: { measuredOn: 'desc' },
          include: { recordedBy: { select: { fullName: true } } },
        },
        immunizations: {
          orderBy: { checkedOn: 'desc' },
          include: { recordedBy: { select: { fullName: true } } },
        },
        absences: { orderBy: { measuredOn: 'desc' } },
        /* Every save ever made against this learner, newest first, including
           the ones a later correction replaced. See MeasurementRevision in
           schema.prisma for why this is a table of its own rather than more
           rows in `measurements`. */
        revisions: {
          orderBy: { at: 'desc' },
          include: { recordedBy: { select: { fullName: true } } },
        },
        /* This school year's invitation; the school relation is how the
           query knows which year that is. */
        slips: { orderBy: { schoolYear: 'desc' }, include: { meeting: true } },
        school: { select: { schoolYear: true } },

        conditions: {
          orderBy: { createdAt: 'asc' },
          include: { recordedBy: { select: { fullName: true } } },
        },
        /* Nulls last: a dose with no legible date on the card is still a dose,
           and Postgres would otherwise sort it above every dated one. */
        vaccineDoses: {
          orderBy: [{ givenOn: { sort: 'desc', nulls: 'last' } }, { vaccine: 'asc' }],
          include: { recordedBy: { select: { fullName: true } } },
        },
        enrolments: {
          orderBy: { schoolYear: 'desc' },
          include: {
            section: { select: { name: true, gradeLevel: { select: { level: true, name: true } } } },
          },
        },
      },
    })
    if (!l) throw notFound('That learner was not found.', 'NO_LEARNER')
    const thisYearSlip = l.slips.find((s) => s.schoolYear === l.school.schoolYear)

    res.json({
      learner: {
        id: l.id,
        lrn: l.lrn,
        lastName: l.lastName,
        firstName: l.firstName,
        middleName: l.middleName ?? '',
        nameExt: l.nameExt ?? '',
        sex: l.sex,
        birthDate: isoDate(l.birthDate),
        section: l.section.name,
        sectionId: l.sectionId,
        gradeLevel: l.section.gradeLevel.level,
        stubId: l.stubId,
        healthNotes: l.healthNotes ?? '',
        /* Set once the learner has left the roster: graduated, transferred
           out, dropped. The record is still whole; it is only not current. */
        archivedAt: l.archivedAt?.toISOString() ?? null,

        conditions: l.conditions.map((c) => ({
          id: c.id,
          condition: c.condition,
          status: c.status,
          treatment: c.treatment ?? '',
          notes: c.notes ?? '',
          recordedOn: isoDate(c.createdAt),
          by: c.recordedBy.fullName,
        })),
        vaccineDoses: l.vaccineDoses.map((d) => ({
          id: d.id,
          vaccine: d.vaccine,
          dose: d.dose,
          givenOn: isoDate(d.givenOn),
          status: d.status,
          remarks: d.remarks ?? '',
          by: d.recordedBy.fullName,
        })),
        /* The point of the enrolment table, read back: the same child in six
           different classes over six years, newest first. */
        enrolments: l.enrolments.map((e) => ({
          schoolYear: e.schoolYear,
          sectionId: e.sectionId,
          section: e.section.name,
          gradeLevel: e.section.gradeLevel.level,
          gradeName: e.section.gradeLevel.name,
          status: e.status,
          outcome: e.outcome,
        })),
        /* Every year's invitation, newest first, for the printed record.
           `slip` below is this year's alone, which is what the screens use. */
        slips: l.slips.map((s) => ({
          schoolYear: s.schoolYear,
          state: SLIP_OUT[s.state],
          printedAt: s.printedAt?.toISOString() ?? null,
          attendedAt: s.attendedAt?.toISOString() ?? null,
        })),

        /* The whole series, oldest last. This is what a second weigh-in
           unlocks and the JSON store could never hold: a learner's own trend
           rather than a single overwritten reading. */
        history: l.measurements.map((m) => ({
          heightCm: num(m.heightCm),
          weightKg: num(m.weightKg),
          measuredOn: isoDate(m.measuredOn),
          note: m.note ?? '',
          recordedAt: m.createdAt.toISOString(),
          by: m.recordedBy.fullName,
        })),
        /* Named "recordings" rather than "revisions" in the DTO: to the
           nurse reading it, this is the list of times somebody weighed this
           child, not a versioning concept. */
        recordings: l.revisions.map((r) => ({
          id: r.id,
          measuredOn: isoDate(r.measuredOn),
          heightCm: r.heightCm === null ? null : num(r.heightCm),
          weightKg: r.weightKg === null ? null : num(r.weightKg),
          kind: r.kind,
          at: r.at.toISOString(),
          by: r.recordedBy.fullName,
        })),
        immunizations: l.immunizations.map((i) => ({
          status: IMMUNIZATION_OUT[i.status],
          checkedOn: isoDate(i.checkedOn),
          by: i.recordedBy.fullName,
        })),
        absences: l.absences.map((a) => ({ measuredOn: isoDate(a.measuredOn) })),
        slip: thisYearSlip
          ? {
              state: SLIP_OUT[thisYearSlip.state],
              printedAt: thisYearSlip.printedAt?.toISOString() ?? null,
              attendedAt: thisYearSlip.attendedAt?.toISOString() ?? null,
              meeting: thisYearSlip.meeting
                ? {
                    date: isoDate(thisYearSlip.meeting.date),
                    time: thisYearSlip.meeting.time,
                    venue: thisYearSlip.meeting.venue,
                  }
                : null,
            }
          : null,
      },
    })
  }),
)

/* --- Correcting a learner -------------------------------------------------

   ONE PUT FOR THE WHOLE EDITABLE RECORD, not nine endpoints. What the dialog
   edits is one form covering the profile, the health history and the
   immunization card, and a Save that fired nine requests would leave
   a half-corrected child behind whichever one failed. It is one body and one
   transaction, so a refused save changes nothing.

   THE LISTS RECONCILE BY ID, THEY DO NOT REPLACE. A row that arrives with an
   id is updated; one without is created; one the payload no longer mentions
   is deleted. Deleting and recreating every row on every save would be
   simpler and would rewrite `recordedById` and `createdAt` each time - so a
   condition first reported in June by the nurse would show as reported today
   by whoever fixed a typo in it. Provenance is the point of those columns.

   SCOPING IS UNCHANGED. The learner must be inside `learnerScope`, and a new
   section must belong to the actor's school.

   THE LRN MAY BE CORRECTED, because it is typed off a form and forms carry
   typos. It is still checked for a clash, excluding this learner.
-------------------------------------------------------------------------- */

/* No guardian rows. Family contact details are no longer collected, and this
   route neither writes nor deletes any rows stored before that. */
const EditRow = {
  condition: z.object({
    id: z.string().cuid().optional(),
    condition: z.string().trim().min(1).max(200),
    status: z.enum(['ACTIVE', 'RESOLVED', 'RECURRING', 'UNKNOWN']).default('UNKNOWN'),
    treatment: optionalText(500),
    notes: optionalText(1000),
  }),
  dose: z.object({
    id: z.string().cuid().optional(),
    vaccine: z.string().trim().min(1).max(80),
    dose: z.string().trim().min(1).max(24),
    givenOn: isoDay.optional(),
    status: z.enum(['GIVEN', 'SCHEDULED', 'MISSED', 'UNKNOWN']).default('GIVEN'),
    remarks: optionalText(200),
  }),
}

const EditLearner = z.object({
  lrn: z.string().trim().regex(/^\d{12}$/, 'The LRN must be 12 digits.'),
  lastName: z.string().trim().min(1, 'The surname is required.').max(80),
  firstName: z.string().trim().min(1, 'The first name is required.').max(80),
  middleName: optionalText(80),
  nameExt: optionalText(16),
  sex: z.enum(['M', 'F']),
  birthDate: isoDay,
  healthNotes: optionalText(2000),

  sectionId: z.string().cuid().optional(),
  enrolmentStatus: z
    .enum(['ENROLLED', 'TRANSFERRED_IN', 'RETURNING', 'TRANSFERRED_OUT', 'DROPPED'])
    .optional(),

  conditions: z.array(EditRow.condition).max(20).default([]),
  doses: z.array(EditRow.dose).max(40).default([]),
})

learnersRouter.put(
  '/:id',
  h(async (req, res) => {
    const actor = actorOf(req)
    const id = z.string().min(1).safeParse(req.params.id)
    if (!id.success) throw badRequest('That learner was not found.', 'INVALID_ID')

    const parsed = EditLearner.safeParse(req.body)
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message ?? 'Check the learner.', 'INVALID_BODY')
    }
    const body = parsed.data

    /* Scope in the WHERE, not checked after the fetch - the timing difference
       between "not found" and "not yours" is itself an oracle. */
    const existing = await db.learner.findFirst({
      where: { id: id.data, ...learnerScope(actor) },
      select: {
        id: true,
        sectionId: true,
        conditions: { select: { id: true } },
        vaccineDoses: { select: { id: true } },
      },
    })
    if (!existing) throw notFound('That learner was not found.', 'NO_LEARNER')

    const clash = await db.learner.findUnique({ where: { lrn: body.lrn }, select: { id: true } })
    if (clash && clash.id !== existing.id) {
      throw conflict(`LRN ${body.lrn} belongs to another learner.`, 'LRN_TAKEN')
    }

    let sectionId = existing.sectionId
    if (body.sectionId && body.sectionId !== existing.sectionId) {
      const section = await db.section.findFirst({
        where: { id: body.sectionId, schoolId: actor.schoolId },
        select: { id: true },
      })
      if (!section) throw notFound('That section is not in this school.', 'NO_SECTION')
      sectionId = section.id
    }

    const school = await db.school.findUnique({
      where: { id: actor.schoolId },
      select: { schoolYear: true },
    })
    if (!school) throw notFound('The school has not been set up yet.', 'NO_SCHOOL')

    const keptConditions = new Set(body.conditions.map((c) => c.id).filter(Boolean) as string[])
    const keptDoses = new Set(body.doses.map((d) => d.id).filter(Boolean) as string[])

    await db.$transaction(async (tx) => {
      await tx.learner.update({
        where: { id: existing.id },
        data: {
          lrn: body.lrn,
          lastName: body.lastName,
          firstName: body.firstName,
          middleName: body.middleName ?? null,
          nameExt: body.nameExt ?? null,
          sex: body.sex,
          birthDate: utcDay(body.birthDate),
          healthNotes: body.healthNotes ?? null,
          sectionId,
        },
      })

      /* The current year's enrolment follows the class, and is created if the
         learner predates the table - which every learner seeded before it
         does. This is the only place those rows appear by themselves, and it
         is honest about who wrote them: whoever saved this edit. */
      const year = school.schoolYear
      const current = await tx.enrolment.findUnique({
        where: { learnerId_schoolYear: { learnerId: existing.id, schoolYear: year } },
        select: { id: true },
      })
      if (current) {
        await tx.enrolment.update({
          where: { id: current.id },
          data: {
            sectionId,
            ...(body.enrolmentStatus ? { status: body.enrolmentStatus } : {}),
          },
        })
      } else {
        await tx.enrolment.create({
          data: {
            learnerId: existing.id,
            schoolYear: year,
            sectionId,
            status: body.enrolmentStatus ?? 'ENROLLED',
            recordedById: actor.id,
          },
        })
      }

      await tx.healthCondition.deleteMany({
        where: { learnerId: existing.id, id: { notIn: [...keptConditions] } },
      })
      for (const c of body.conditions) {
        const data = {
          condition: c.condition,
          status: c.status,
          treatment: c.treatment ?? null,
          notes: c.notes ?? null,
        }
        if (c.id) await tx.healthCondition.update({ where: { id: c.id }, data })
        else
          await tx.healthCondition.create({
            data: { ...data, learnerId: existing.id, recordedById: actor.id },
          })
      }

      await tx.vaccineDose.deleteMany({
        where: { learnerId: existing.id, id: { notIn: [...keptDoses] } },
      })
      for (const d of body.doses) {
        const data = {
          vaccine: d.vaccine,
          dose: d.dose,
          givenOn: d.givenOn ? utcDay(d.givenOn) : null,
          status: d.status,
          remarks: d.remarks ?? null,
        }
        if (d.id) await tx.vaccineDose.update({ where: { id: d.id }, data })
        else
          await tx.vaccineDose.create({
            data: { ...data, learnerId: existing.id, recordedById: actor.id },
          })
      }
    })

    /* Ids and counts, never the values. A corrected condition must not land
       in a log that gets pasted into a ticket. */
    audit({
      actorId: actor.id,
      action: 'LEARNER_UPDATED',
      targetType: 'learner',
      targetId: existing.id,
      detail: {
        sectionId,
        moved: sectionId !== existing.sectionId,
        conditions: body.conditions.length,
        doses: body.doses.length,
      },
      ipAddress: ipOf(req),
    })

    res.json({ ok: true })
  }),
)

/* --- Deleting a learner ---------------------------------------------------

   FOR A RECORD THAT SHOULD NEVER HAVE BEEN MADE: a learner enrolled twice, a
   spreadsheet imported into the wrong class, a test entry. It is not how a
   learner leaves the school - a learner who transfers out or finishes Grade 6
   is archived (the rollover, or POST /learners/:id/archive) and keeps their
   record under Former learners, because that record is still the school's.

   Deleting is permanent. Every table that holds something about the child
   (measurements and their revisions, absences, immunization checks, slips,
   enrolments, guardians, conditions, doses, feeding beneficiaries) cascades
   from the learner row, so the one delete removes all of it, and nothing is
   left behind pointing at an id that no longer exists. A follow-up weigh-in's
   `learnerIds` may still list it; that list is only ever read as a filter
   over the roster, so a stale id there matches nobody.

   The audit entry keeps the counts of what went with it, never the name or
   LRN - see lib/audit.ts. */

learnersRouter.delete(
  '/:id',
  h(async (req, res) => {
    const actor = actorOf(req)
    const id = z.string().min(1).safeParse(req.params.id)
    if (!id.success) throw notFound('That learner was not found.', 'NO_LEARNER')

    const existing = await db.learner.findFirst({
      where: { id: id.data, ...learnerScope(actor) },
      select: {
        id: true,
        sectionId: true,
        archivedAt: true,
        _count: { select: { measurements: true, slips: true } },
      },
    })
    if (!existing) throw notFound('That learner was not found.', 'NO_LEARNER')

    await db.learner.delete({ where: { id: existing.id } })

    audit({
      actorId: actor.id,
      action: 'LEARNER_DELETED',
      targetType: 'learner',
      targetId: existing.id,
      detail: {
        sectionId: existing.sectionId,
        archived: existing.archivedAt !== null,
        measurements: existing._count.measurements,
        slips: existing._count.slips,
      },
      ipAddress: ipOf(req),
    })

    res.status(204).end()
  }),
)
