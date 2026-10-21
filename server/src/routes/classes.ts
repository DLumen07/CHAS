/* Year levels and sections, as the head sets them up. School head only.

   Both were fixed at first launch until 2026-10-17: six grades, one section
   each, created from data/mock.ts. The user asked for the head to be able to
   lay the school out in School settings instead - add, rename, reorder and
   remove year levels, and add, rename, move and remove the sections under
   them.

   THE LEVEL IS THE POSITION. `grade_levels.level` orders the year levels,
   prefixes new stub ids and is what a rollover promotes along (level + 1),
   so a gap would strand every learner below it. The head never types it:
   the list's order is the level, 1 to n, and every add, move and removal
   renumbers the rest so the numbers stay consecutive.

   NOTHING THAT HOLDS A RECORD IS REMOVED. A section any learner or
   enrolment points at - archived learners included, because their
   measurements are in an SF8 already submitted - cannot be deleted, only
   renamed. A year level with sections cannot be deleted either. */

import { Router } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { db } from '../db.js'
import { audit } from '../lib/audit.js'
import { badRequest, conflict, notFound } from '../lib/errors.js'
import { h, ipOf } from '../lib/http.js'
import { actorOf, requireAdmin, requireAuth } from '../auth/middleware.js'

export const classesRouter = Router()

classesRouter.use(requireAuth, requireAdmin)

type Tx = Prisma.TransactionClient

const name = (label: string) =>
  z.string().trim().min(1, `Enter the ${label}.`).max(60, `The ${label} is too long.`)

function parse<T>(schema: z.ZodType<T>, body: unknown, fallback: string): T {
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? fallback, 'INVALID_BODY')
  return parsed.data
}

/** The school's year levels, in order, each with its sections and how many
    learners and records each section holds. */
async function layout(schoolId: string) {
  const grades = await db.gradeLevel.findMany({
    where: { schoolId },
    orderBy: { level: 'asc' },
    select: {
      id: true,
      name: true,
      level: true,
      sections: {
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          adviser: true,
          _count: { select: { learners: true, enrolments: true } },
        },
      },
    },
  })
  const active = await db.learner.groupBy({
    by: ['sectionId'],
    where: { schoolId, archivedAt: null },
    _count: { _all: true },
  })
  const activeBy = new Map(active.map((a) => [a.sectionId, a._count._all]))
  return grades.map((g) => ({
    id: g.id,
    name: g.name,
    level: g.level,
    sections: g.sections.map((s) => ({
      id: s.id,
      name: s.name,
      adviser: s.adviser ?? '',
      /** Learners on the roster now. */
      learners: activeBy.get(s.id) ?? 0,
      /** False once any learner or enrolment, past or present, points here. */
      removable: s._count.learners === 0 && s._count.enrolments === 0,
    })),
  }))
}

/** Sets the levels to 1..n in the order given. Two passes, because the
    (school, level) pair is unique and a straight swap would collide. */
async function renumber(tx: Tx, ids: string[]) {
  for (let i = 0; i < ids.length; i++) {
    await tx.gradeLevel.update({ where: { id: ids[i] }, data: { level: -(i + 1) } })
  }
  for (let i = 0; i < ids.length; i++) {
    await tx.gradeLevel.update({ where: { id: ids[i] }, data: { level: i + 1 } })
  }
}

async function orderedIds(tx: Tx, schoolId: string): Promise<string[]> {
  const rows = await tx.gradeLevel.findMany({ where: { schoolId }, orderBy: { level: 'asc' }, select: { id: true } })
  return rows.map((r) => r.id)
}

async function gradeNameTaken(schoolId: string, value: string, except?: string) {
  const row = await db.gradeLevel.findFirst({
    where: { schoolId, name: { equals: value, mode: 'insensitive' }, ...(except ? { id: { not: except } } : {}) },
    select: { id: true },
  })
  return row !== null
}

async function sectionNameTaken(schoolId: string, value: string, except?: string) {
  const row = await db.section.findFirst({
    where: { schoolId, name: { equals: value, mode: 'insensitive' }, ...(except ? { id: { not: except } } : {}) },
    select: { id: true },
  })
  return row !== null
}

async function gradeOf(schoolId: string, id: string) {
  const g = await db.gradeLevel.findFirst({ where: { id, schoolId }, select: { id: true, name: true } })
  if (!g) throw notFound('That year level no longer exists.', 'NO_GRADE')
  return g
}

async function sectionOf(schoolId: string, id: string) {
  const s = await db.section.findFirst({ where: { id, schoolId }, select: { id: true, name: true } })
  if (!s) throw notFound('That section no longer exists.', 'NO_SECTION')
  return s
}

classesRouter.get(
  '/',
  h(async (req, res) => {
    res.json({ grades: await layout(actorOf(req).schoolId) })
  }),
)

/* --- Year levels --------------------------------------------------------- */

const GradeBody = z.object({ name: name('year level name') })

classesRouter.post(
  '/grades',
  h(async (req, res) => {
    const actor = actorOf(req)
    const body = parse(GradeBody, req.body, 'Check the year level.')
    if (await gradeNameTaken(actor.schoolId, body.name)) {
      throw conflict(`There is already a year level named ${body.name}.`, 'GRADE_NAME_TAKEN')
    }
    const last = await db.gradeLevel.findFirst({
      where: { schoolId: actor.schoolId },
      orderBy: { level: 'desc' },
      select: { level: true },
    })
    const g = await db.gradeLevel.create({
      data: { schoolId: actor.schoolId, name: body.name, level: (last?.level ?? 0) + 1 },
      select: { id: true },
    })
    audit({
      actorId: actor.id,
      action: 'GRADE_LEVEL_CREATED',
      targetType: 'grade_level',
      targetId: g.id,
      detail: { name: body.name },
      ipAddress: ipOf(req),
    })
    res.status(201).json({ grades: await layout(actor.schoolId) })
  }),
)

classesRouter.put(
  '/grades/:id',
  h(async (req, res) => {
    const actor = actorOf(req)
    const g = await gradeOf(actor.schoolId, String(req.params.id))
    const body = parse(GradeBody, req.body, 'Check the year level.')
    if (await gradeNameTaken(actor.schoolId, body.name, g.id)) {
      throw conflict(`There is already a year level named ${body.name}.`, 'GRADE_NAME_TAKEN')
    }
    await db.gradeLevel.update({ where: { id: g.id }, data: { name: body.name } })
    audit({
      actorId: actor.id,
      action: 'GRADE_LEVEL_RENAMED',
      targetType: 'grade_level',
      targetId: g.id,
      detail: { from: g.name, to: body.name },
      ipAddress: ipOf(req),
    })
    res.json({ grades: await layout(actor.schoolId) })
  }),
)

/* One place up or down the list. */
classesRouter.post(
  '/grades/:id/move',
  h(async (req, res) => {
    const actor = actorOf(req)
    const g = await gradeOf(actor.schoolId, String(req.params.id))
    const { direction } = parse(z.object({ direction: z.enum(['up', 'down']) }), req.body, 'Choose a direction.')
    await db.$transaction(async (tx) => {
      const ids = await orderedIds(tx, actor.schoolId)
      const i = ids.indexOf(g.id)
      const j = direction === 'up' ? i - 1 : i + 1
      if (i < 0 || j < 0 || j >= ids.length) return
      ;[ids[i], ids[j]] = [ids[j], ids[i]]
      await renumber(tx, ids)
    })
    audit({
      actorId: actor.id,
      action: 'GRADE_LEVEL_MOVED',
      targetType: 'grade_level',
      targetId: g.id,
      detail: { name: g.name, direction },
      ipAddress: ipOf(req),
    })
    res.json({ grades: await layout(actor.schoolId) })
  }),
)

classesRouter.delete(
  '/grades/:id',
  h(async (req, res) => {
    const actor = actorOf(req)
    const g = await gradeOf(actor.schoolId, String(req.params.id))
    const sections = await db.section.count({ where: { gradeLevelId: g.id } })
    if (sections > 0) {
      throw conflict(`Remove or move the sections under ${g.name} first.`, 'GRADE_HAS_SECTIONS')
    }
    await db.$transaction(async (tx) => {
      await tx.gradeLevel.delete({ where: { id: g.id } })
      await renumber(tx, await orderedIds(tx, actor.schoolId))
    })
    audit({
      actorId: actor.id,
      action: 'GRADE_LEVEL_DELETED',
      targetType: 'grade_level',
      targetId: g.id,
      detail: { name: g.name },
      ipAddress: ipOf(req),
    })
    res.json({ grades: await layout(actor.schoolId) })
  }),
)

/* --- Sections ------------------------------------------------------------ */

const SectionBody = z.object({
  name: name('section name'),
  gradeLevelId: z.string().min(1, 'Choose a year level.'),
  /* Printed on the SF8. Optional: a new section may not have one yet. */
  adviser: z.string().trim().max(80, 'The adviser name is too long.').default(''),
})

classesRouter.post(
  '/sections',
  h(async (req, res) => {
    const actor = actorOf(req)
    const body = parse(SectionBody, req.body, 'Check the section.')
    const g = await gradeOf(actor.schoolId, body.gradeLevelId)
    if (await sectionNameTaken(actor.schoolId, body.name)) {
      throw conflict(`There is already a section named ${body.name}.`, 'SECTION_NAME_TAKEN')
    }
    const s = await db.section.create({
      data: { schoolId: actor.schoolId, name: body.name, gradeLevelId: g.id, adviser: body.adviser || null },
      select: { id: true },
    })
    audit({
      actorId: actor.id,
      action: 'SECTION_CREATED',
      targetType: 'section',
      targetId: s.id,
      detail: { name: body.name, grade: g.name },
      ipAddress: ipOf(req),
    })
    res.status(201).json({ grades: await layout(actor.schoolId) })
  }),
)

classesRouter.put(
  '/sections/:id',
  h(async (req, res) => {
    const actor = actorOf(req)
    const s = await sectionOf(actor.schoolId, String(req.params.id))
    const body = parse(SectionBody, req.body, 'Check the section.')
    const g = await gradeOf(actor.schoolId, body.gradeLevelId)
    if (await sectionNameTaken(actor.schoolId, body.name, s.id)) {
      throw conflict(`There is already a section named ${body.name}.`, 'SECTION_NAME_TAKEN')
    }
    await db.section.update({
      where: { id: s.id },
      data: { name: body.name, gradeLevelId: g.id, adviser: body.adviser || null },
    })
    audit({
      actorId: actor.id,
      action: 'SECTION_UPDATED',
      targetType: 'section',
      targetId: s.id,
      detail: { from: s.name, to: body.name, grade: g.name },
      ipAddress: ipOf(req),
    })
    res.json({ grades: await layout(actor.schoolId) })
  }),
)

classesRouter.delete(
  '/sections/:id',
  h(async (req, res) => {
    const actor = actorOf(req)
    const s = await sectionOf(actor.schoolId, String(req.params.id))
    const [learners, enrolments] = await Promise.all([
      db.learner.count({ where: { sectionId: s.id } }),
      db.enrolment.count({ where: { sectionId: s.id } }),
    ])
    if (learners + enrolments > 0) {
      throw conflict(`${s.name} has learner records and cannot be removed. Rename it instead.`, 'SECTION_IN_USE')
    }
    await db.section.delete({ where: { id: s.id } })
    audit({
      actorId: actor.id,
      action: 'SECTION_DELETED',
      targetType: 'section',
      targetId: s.id,
      detail: { name: s.name },
      ipAddress: ipOf(req),
    })
    res.json({ grades: await layout(actor.schoolId) })
  }),
)
