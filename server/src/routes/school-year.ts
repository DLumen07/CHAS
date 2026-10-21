/* Moving the school to a new school year. School head only.

   WHAT A ROLLOVER IS. Every learner on the roster gets an ending for the year
   that is closing - promoted, retained, completed the last grade, transferred
   out or dropped - written on their enrolment row for that year. Those who
   stay get an enrolment row for the new year and move to their new section;
   those who leave are archived, never deleted, because their measurements are
   in an SF8 that has already gone to the division. The school's year label
   moves on, the advisers' names can be replaced, and the parent meeting that
   was "next" stops being next. Measurements are not touched: the weigh-in
   rounds are dated, so the new year's queue is empty without anyone clearing
   it, and slips are kept per year.

   One transaction. A rollover that stopped halfway would leave half the
   school a grade up, and nobody could tell which half.

   WHY IT CAN BE UNDONE. Last year's enrolment row still names the section
   each child was in, and the rollover log keeps the two things that are
   overwritten (advisers and the current meeting). So until anybody records
   something in the new year, the head can take the whole thing back. Once a
   weigh-in, a slip or an enrolment exists in the new year, an undo would have
   to decide what that new record means, so it is refused instead. */

import { Router } from 'express'
import { z } from 'zod'
import type { EnrolmentOutcome, Prisma } from '@prisma/client'
import { db } from '../db.js'
import { audit } from '../lib/audit.js'
import { badRequest, conflict, notFound } from '../lib/errors.js'
import { h, ipOf } from '../lib/http.js'
import { actorOf, requireAdmin, requireAuth } from '../auth/middleware.js'
import { nextSchoolYear } from '../lib/school.js'

export const schoolYearRouter = Router()

schoolYearRouter.use(requireAuth, requireAdmin)

const LEAVING: EnrolmentOutcome[] = ['COMPLETED', 'TRANSFERRED_OUT', 'DROPPED']

type Tx = Prisma.TransactionClient

/* --- Reading the year ---------------------------------------------------- */

/** Why the last rollover can no longer be undone, as sentences. Empty means
    it can. */
async function undoBlockers(tx: Tx, schoolId: string, toYear: string, since: Date): Promise<string[]> {
  const ofSchool = { learner: { schoolId } }
  const after = { gt: since }
  const [measurements, absences, immunizations, slips, meetings, enrolments, learners] = await Promise.all([
    tx.measurementRevision.count({ where: { ...ofSchool, at: after } }),
    tx.absence.count({ where: { ...ofSchool, createdAt: after } }),
    tx.immunization.count({ where: { ...ofSchool, createdAt: after } }),
    tx.slip.count({ where: { ...ofSchool, schoolYear: toYear } }),
    tx.meeting.count({ where: { schoolId, createdAt: after } }),
    tx.enrolment.count({
      where: { ...ofSchool, schoolYear: toYear, OR: [{ createdAt: after }, { updatedAt: after }] },
    }),
    tx.learner.count({ where: { schoolId, OR: [{ createdAt: after }, { updatedAt: after }] } }),
  ])
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`
  const out: string[] = []
  if (measurements) out.push(`${n(measurements, 'weigh-in was', 'weigh-ins were')} saved`)
  if (absences) out.push(`${n(absences, 'learner was', 'learners were')} marked absent`)
  if (immunizations) out.push(`${n(immunizations, 'immunization card was', 'immunization cards were')} checked`)
  if (slips) out.push(`${n(slips, 'invitation slip was', 'invitation slips were')} printed`)
  if (meetings) out.push('a parent meeting was set')
  if (enrolments || learners) out.push('learner records were added or edited')
  return out.map((s) => `${s[0].toUpperCase()}${s.slice(1)} in the new school year.`)
}

/** The school's grades, lowest first, each with its sections. */
async function gradesOf(tx: Tx, schoolId: string) {
  return tx.gradeLevel.findMany({
    where: { schoolId },
    orderBy: { level: 'asc' },
    select: {
      level: true,
      name: true,
      sections: { orderBy: { name: 'asc' }, select: { id: true, name: true, adviser: true } },
    },
  })
}

schoolYearRouter.get(
  '/',
  h(async (req, res) => {
    const actor = actorOf(req)
    const school = await db.school.findUnique({
      where: { id: actor.schoolId },
      select: { schoolYear: true },
    })
    if (!school) throw notFound('The school has not been set up yet.', 'NO_SCHOOL')

    const grades = await gradesOf(db, actor.schoolId)

    /* A learner the school has already marked as gone during the year ends
       it that way by default, rather than being promoted. */
    const marked = await db.enrolment.findMany({
      where: {
        schoolYear: school.schoolYear,
        status: { in: ['TRANSFERRED_OUT', 'DROPPED'] },
        learner: { schoolId: actor.schoolId, archivedAt: null },
      },
      select: { learnerId: true, status: true },
    })

    /* Only the newest rollover can be taken back, and only while the school
       is still in the year it opened. */
    const last = await db.schoolYearRollover.findFirst({
      where: { schoolId: actor.schoolId, undoneAt: null },
      orderBy: { rolledAt: 'desc' },
      include: { rolledBy: { select: { fullName: true } } },
    })
    const undoable = last && last.toYear === school.schoolYear ? last : null

    res.json({
      schoolYear: school.schoolYear,
      nextYear: nextSchoolYear(school.schoolYear),
      grades: grades.map((g) => ({
        level: g.level,
        name: g.name,
        sections: g.sections.map((s) => ({ id: s.id, name: s.name, adviser: s.adviser ?? '' })),
      })),
      defaults: Object.fromEntries(marked.map((e) => [e.learnerId, e.status])),
      lastRollover: undoable
        ? {
            id: undoable.id,
            fromYear: undoable.fromYear,
            toYear: undoable.toYear,
            rolledAt: undoable.rolledAt.toISOString(),
            by: undoable.rolledBy.fullName,
            blockers: await undoBlockers(db, actor.schoolId, undoable.toYear, undoable.rolledAt),
          }
        : null,
    })
  }),
)

/* --- Rolling over -------------------------------------------------------- */

const Outcome = z.enum(['PROMOTED', 'RETAINED', 'COMPLETED', 'TRANSFERRED_OUT', 'DROPPED'])

const RolloverBody = z.object({
  /* The year the head was looking at. If somebody else moved the school on
     in the meantime, this no longer matches and nothing happens. */
  fromYear: z.string().min(1).max(20),
  toYear: z.string().trim().regex(/^\d{4}-\d{4}$/, 'Write the school year as 2027-2028.'),
  /* Only the exceptions. Everybody not named here is promoted, or completes
     if they are in the school's last grade. */
  outcomes: z.record(z.string().min(1), Outcome).default({}),
  /* Where each section's promoted learners go, by section id. Needed only
     where the next grade has more than one section. */
  sectionMap: z.record(z.string().min(1), z.string().min(1)).default({}),
  /* The advisers for the new year, by section id. Sections left out keep
     the name they have. */
  advisers: z.record(z.string().min(1), z.string().trim().max(120)).default({}),
})

schoolYearRouter.post(
  '/rollover',
  h(async (req, res) => {
    const actor = actorOf(req)
    const parsed = RolloverBody.safeParse(req.body)
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message ?? 'Check the new school year.', 'INVALID_BODY')
    }
    const body = parsed.data

    const [a, b] = body.toYear.split('-').map(Number)
    const [fa] = body.fromYear.split('-').map(Number)
    if (b !== a + 1) throw badRequest('The two years must follow each other, as in 2027-2028.', 'BAD_YEAR')
    if (Number.isFinite(fa) && a <= fa) {
      throw badRequest(`The new school year must come after ${body.fromYear}.`, 'BAD_YEAR')
    }

    const result = await db.$transaction(
      async (tx) => {
        const school = await tx.school.findUnique({
          where: { id: actor.schoolId },
          select: { schoolYear: true },
        })
        if (!school) throw notFound('The school has not been set up yet.', 'NO_SCHOOL')
        if (school.schoolYear !== body.fromYear) {
          throw conflict(
            `The school year has already changed to ${school.schoolYear}. Open this screen again.`,
            'YEAR_CHANGED',
          )
        }

        const grades = await gradesOf(tx, actor.schoolId)
        const top = grades.at(-1)?.level ?? 0
        const sectionLevel = new Map<string, number>()
        for (const g of grades) for (const s of g.sections) sectionLevel.set(s.id, g.level)
        const sectionsAt = (level: number) => grades.find((g) => g.level === level)?.sections ?? []

        const learners = await tx.learner.findMany({
          where: { schoolId: actor.schoolId, archivedAt: null },
          select: {
            id: true,
            sectionId: true,
            enrolments: {
              where: { schoolYear: body.fromYear },
              select: { id: true, status: true },
            },
          },
        })
        const active = new Set(learners.map((l) => l.id))
        for (const id of Object.keys(body.outcomes)) {
          if (!active.has(id)) {
            throw conflict(
              'The learner list has changed. Close this window and try again.',
              'ROSTER_CHANGED',
            )
          }
        }

        /* --- Decide every learner's ending and where they go ------------- */
        const ending = new Map<string, EnrolmentOutcome>()
        const moveTo = new Map<string, string>() // learner -> new section
        for (const l of learners) {
          const level = sectionLevel.get(l.sectionId) ?? 0
          const status = l.enrolments[0]?.status
          const outcome: EnrolmentOutcome =
            body.outcomes[l.id] ??
            (status === 'TRANSFERRED_OUT' || status === 'DROPPED'
              ? status
              : level === top
                ? 'COMPLETED'
                : 'PROMOTED')

          if (outcome === 'PROMOTED' && level === top) {
            throw badRequest('A learner in the last grade cannot be promoted. Mark them as completed.', 'BAD_OUTCOME')
          }
          if (outcome === 'COMPLETED' && level !== top) {
            throw badRequest('Only learners in the last grade can complete it.', 'BAD_OUTCOME')
          }
          ending.set(l.id, outcome)

          if (outcome === 'RETAINED') moveTo.set(l.id, l.sectionId)
          if (outcome === 'PROMOTED') {
            const next = sectionsAt(level + 1)
            const mapped = body.sectionMap[l.sectionId]
            let target: string | undefined
            if (mapped) {
              if (!next.some((s) => s.id === mapped)) {
                throw badRequest('Choose a section for each class.', 'BAD_SECTION_MAP')
              }
              target = mapped
            } else if (next.length === 1) {
              target = next[0].id
            } else if (next.length === 0) {
              const from = grades.find((g) => g.level === level)?.name ?? `Grade ${level}`
              throw badRequest(`${from} has no next grade level with a section.`, 'NO_NEXT_GRADE')
            } else {
              throw badRequest('Select a destination section for each class.', 'SECTION_MAP_NEEDED')
            }
            moveTo.set(l.id, target)
          }
        }

        /* --- Write the endings on this year's enrolments ---------------
           A learner registered before the enrolment table existed has no
           row for this year; one is written now, in their present section,
           so the year they are leaving is on file too. */
        const missing = learners.filter((l) => l.enrolments.length === 0)
        if (missing.length) {
          await tx.enrolment.createMany({
            data: missing.map((l) => ({
              learnerId: l.id,
              schoolYear: body.fromYear,
              sectionId: l.sectionId,
              recordedById: actor.id,
            })),
          })
        }
        const byOutcome = new Map<EnrolmentOutcome, string[]>()
        for (const [id, o] of ending) byOutcome.set(o, [...(byOutcome.get(o) ?? []), id])
        for (const [outcome, ids] of byOutcome) {
          await tx.enrolment.updateMany({
            where: { learnerId: { in: ids }, schoolYear: body.fromYear },
            data: { outcome },
          })
        }

        /* --- Open the new year for those who stay ----------------------- */
        if (moveTo.size) {
          await tx.enrolment.createMany({
            data: [...moveTo].map(([learnerId, sectionId]) => ({
              learnerId,
              schoolYear: body.toYear,
              sectionId,
              recordedById: actor.id,
            })),
            skipDuplicates: true,
          })
          const bySection = new Map<string, string[]>()
          for (const [id, s] of moveTo) bySection.set(s, [...(bySection.get(s) ?? []), id])
          for (const [sectionId, ids] of bySection) {
            await tx.learner.updateMany({ where: { id: { in: ids } }, data: { sectionId } })
          }
        }

        /* --- Archive those who leave ------------------------------------ */
        const leaving = [...ending].filter(([, o]) => LEAVING.includes(o)).map(([id]) => id)
        if (leaving.length) {
          await tx.learner.updateMany({ where: { id: { in: leaving } }, data: { archivedAt: new Date() } })
        }

        /* --- Advisers ----------------------------------------------------- */
        const advisersBefore: Record<string, string | null> = {}
        for (const g of grades) for (const s of g.sections) advisersBefore[s.id] = s.adviser
        for (const [sectionId, name] of Object.entries(body.advisers)) {
          if (!(sectionId in advisersBefore)) continue
          if ((advisersBefore[sectionId] ?? '') === name) continue
          await tx.section.update({ where: { id: sectionId }, data: { adviser: name || null } })
        }

        /* --- The meeting stops being "next" ------------------------------ */
        const meeting = await tx.meeting.findFirst({
          where: { schoolId: actor.schoolId, isCurrent: true },
          select: { id: true },
        })
        if (meeting) await tx.meeting.update({ where: { id: meeting.id }, data: { isCurrent: false } })

        await tx.school.update({ where: { id: actor.schoolId }, data: { schoolYear: body.toYear } })

        /* Last, so its time is after every write above. */
        const rollover = await tx.schoolYearRollover.create({
          data: {
            schoolId: actor.schoolId,
            fromYear: body.fromYear,
            toYear: body.toYear,
            advisersBefore,
            meetingId: meeting?.id ?? null,
            rolledById: actor.id,
            rolledAt: new Date(),
          },
        })

        const count = (o: EnrolmentOutcome) => byOutcome.get(o)?.length ?? 0
        return {
          rolloverId: rollover.id,
          counts: {
            promoted: count('PROMOTED'),
            retained: count('RETAINED'),
            completed: count('COMPLETED'),
            transferredOut: count('TRANSFERRED_OUT'),
            dropped: count('DROPPED'),
          },
        }
      },
      /* A whole school in one transaction; the default five seconds is for
         a single save. */
      { timeout: 60_000, maxWait: 10_000 },
    )

    audit({
      actorId: actor.id,
      action: 'SCHOOL_YEAR_ROLLED_OVER',
      targetType: 'school',
      targetId: actor.schoolId,
      detail: { fromYear: body.fromYear, toYear: body.toYear, ...result.counts },
      ipAddress: ipOf(req),
    })

    res.status(201).json({ ok: true, schoolYear: body.toYear, ...result })
  }),
)

/* --- Undoing the last rollover ------------------------------------------- */

const UndoBody = z.object({ rolloverId: z.string().min(1) })

schoolYearRouter.post(
  '/undo',
  h(async (req, res) => {
    const actor = actorOf(req)
    const parsed = UndoBody.safeParse(req.body)
    if (!parsed.success) throw badRequest('Choose the school year change to undo.', 'INVALID_BODY')

    const done = await db.$transaction(
      async (tx) => {
        const school = await tx.school.findUnique({
          where: { id: actor.schoolId },
          select: { schoolYear: true },
        })
        if (!school) throw notFound('The school has not been set up yet.', 'NO_SCHOOL')

        const last = await tx.schoolYearRollover.findFirst({
          where: { schoolId: actor.schoolId, undoneAt: null },
          orderBy: { rolledAt: 'desc' },
        })
        if (!last || last.id !== parsed.data.rolloverId || last.toYear !== school.schoolYear) {
          throw conflict('This change can no longer be undone. Open this screen again.', 'NOT_UNDOABLE')
        }
        const blockers = await undoBlockers(tx, actor.schoolId, last.toYear, last.rolledAt)
        if (blockers.length) throw conflict(blockers[0], 'NEW_YEAR_HAS_RECORDS')

        /* Everyone the rollover gave an ending to, and the section they were
           in that year. */
        const closed = await tx.enrolment.findMany({
          where: { schoolYear: last.fromYear, outcome: { not: null }, learner: { schoolId: actor.schoolId } },
          select: { learnerId: true, sectionId: true, outcome: true },
        })

        const back = new Map<string, string[]>()
        const unarchive: string[] = []
        for (const e of closed) {
          if (LEAVING.includes(e.outcome!)) unarchive.push(e.learnerId)
          else back.set(e.sectionId, [...(back.get(e.sectionId) ?? []), e.learnerId])
        }
        for (const [sectionId, ids] of back) {
          await tx.learner.updateMany({ where: { id: { in: ids } }, data: { sectionId } })
        }
        if (unarchive.length) {
          await tx.learner.updateMany({ where: { id: { in: unarchive } }, data: { archivedAt: null } })
        }

        await tx.enrolment.deleteMany({
          where: { schoolYear: last.toYear, learner: { schoolId: actor.schoolId } },
        })
        await tx.enrolment.updateMany({
          where: { schoolYear: last.fromYear, learner: { schoolId: actor.schoolId } },
          data: { outcome: null },
        })

        const before = (last.advisersBefore ?? {}) as Record<string, string | null>
        for (const [sectionId, adviser] of Object.entries(before)) {
          await tx.section.updateMany({
            where: { id: sectionId, schoolId: actor.schoolId },
            data: { adviser },
          })
        }

        if (last.meetingId) {
          await tx.meeting.updateMany({
            where: { id: last.meetingId, schoolId: actor.schoolId },
            data: { isCurrent: true },
          })
        }

        await tx.school.update({ where: { id: actor.schoolId }, data: { schoolYear: last.fromYear } })
        await tx.schoolYearRollover.update({ where: { id: last.id }, data: { undoneAt: new Date() } })

        return { fromYear: last.fromYear, toYear: last.toYear, learners: closed.length }
      },
      { timeout: 60_000, maxWait: 10_000 },
    )

    audit({
      actorId: actor.id,
      action: 'SCHOOL_YEAR_ROLLOVER_UNDONE',
      targetType: 'school',
      targetId: actor.schoolId,
      detail: done,
      ipAddress: ipOf(req),
    })

    res.json({ ok: true, schoolYear: done.fromYear })
  }),
)
