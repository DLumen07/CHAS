/* Everything that writes.

   Measurements, absences, immunization checks, slips and the meeting. Every
   route here calls `assertLearnerInScope` before it touches a row, and every
   one of them writes an audit entry after.

   THE UPSERT PATTERN, because it appears four times below. Each of these
   tables has a unique key of (learner, date), which makes a second entry for
   the same day a CORRECTION rather than a new fact - the nurse re-typing a
   height she fat-fingered must not leave two rows that the reports then
   double-count. `upsert` on that key is the whole enforcement; the constraint
   in the schema is what makes it safe under concurrent writes rather than
   merely usually right. */

import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db.js'
import { audit } from '../lib/audit.js'
import { badRequest, notFound } from '../lib/errors.js'
import { h, ipOf } from '../lib/http.js'
import { actorOf, requireAuth } from '../auth/middleware.js'
import { assertLearnerInScope, learnerScope } from '../auth/session.js'
import { currentSchoolYear } from '../lib/school.js'

export const recordsRouter = Router()

recordsRouter.use(requireAuth)

/* A YYYY-MM-DD string, parsed to UTC midnight so a DATE column round-trips
   unchanged. `new Date('2026-08-04')` already parses as UTC; the explicit
   form below is here so nobody "fixes" it into a local-time constructor
   later, which would shift the date for anyone west of Greenwich. */
const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date.')
  .transform((s) => new Date(`${s}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), 'Enter a valid date.')

/* --- Measurements -------------------------------------------------------- */

/* Every weigh-in on file, for the growth line on the dashboards.

   The roster endpoint sends each learner's NEWEST measurement only, which is
   right for "status today" and useless for "how has it moved". This sends
   the raw rows - one per learner per session date, corrections already folded
   in by the upsert - and nothing else. Bands are not computed here: the WHO
   tables live in the client, and a second copy on the server would be a
   second thing to keep in agreement.

   Scoped like every read: the head and the nurse get the school's. Archived learners are left out, as on the roster. */
recordsRouter.get(
  '/measurements',
  h(async (req, res) => {
    const actor = actorOf(req)
    const rows = await db.measurement.findMany({
      where: { learner: { ...learnerScope(actor), archivedAt: null } },
      orderBy: { measuredOn: 'asc' },
      select: { learnerId: true, measuredOn: true, heightCm: true, weightKg: true },
    })
    res.json({
      measurements: rows.map((m) => ({
        learnerId: m.learnerId,
        measuredOn: m.measuredOn.toISOString().slice(0, 10),
        heightCm: Number(m.heightCm),
        weightKg: Number(m.weightKg),
      })),
    })
  }),
)

const MeasurementBody = z.object({
  learnerId: z.string().min(1),
  /* Bounds are sanity rails, not clinical judgement. They exist to catch a
     height typed into the weight box - a real 300kg entry for a nine-year-old
     is a typo every time, and rejecting it at the door is cheaper than
     finding it in an SF8. The WHO tables do the actual assessing. */
  heightCm: z.number().min(50).max(220),
  weightKg: z.number().min(5).max(200),
  measuredOn: IsoDate,
  /* The nurse's note on this weigh-in. Empty clears it on a correction. */
  note: z.string().trim().max(300, 'The note is too long.').optional(),
})

recordsRouter.post(
  '/measurements',
  h(async (req, res) => {
    const actor = actorOf(req)
    const parsed = MeasurementBody.safeParse(req.body)
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message ?? 'Check the measurement.', 'INVALID_BODY')
    }
    const { learnerId, heightCm, weightKg, measuredOn } = parsed.data
    const note = parsed.data.note ? parsed.data.note : null
    await assertLearnerInScope(actor, learnerId)

    /* One decimal, fixed here rather than trusted from the client. The scale
       reads to 0.1 and the column stores Decimal(4,1); letting 24.06 through
       would round on write and make the stored value disagree with the value
       the client is still displaying. */
    const h1 = Math.round(heightCm * 10) / 10
    const w1 = Math.round(weightKg * 10) / 10

    const row = await db.$transaction(async (tx) => {
      /* Recording a measurement clears any absence for the same session. The
         two are mutually exclusive statements about one child on one day, and
         a learner who was marked absent and then walked in late must not end
         up as both. */
      await tx.absence.deleteMany({ where: { learnerId, measuredOn } })

      /* EVERY SAVE IS KEPT, and this is where that happens.

         The upsert below is right for the SF8 - one height and one weight per
         session, so a correction replaces rather than accumulates - and it is
         also how the previous figure used to disappear without trace. The
         revision row is written FIRST, inside the same transaction, so a
         correction that lands is a correction that was logged: there is no
         ordering in which the measurement changes and the account of it does
         not.

         Whether this is a first entry or a correction is decided by looking,
         not by catching a constraint error. It costs one indexed lookup on a
         unique key and it is the difference between a history that reads
         "recorded, corrected" and one that reads "recorded, recorded". */
      const existing = await tx.measurement.findUnique({
        where: { learnerId_measuredOn: { learnerId, measuredOn } },
        select: { id: true },
      })
      await tx.measurementRevision.create({
        data: {
          learnerId,
          measuredOn,
          heightCm: h1,
          weightKg: w1,
          kind: existing ? 'CORRECTED' : 'RECORDED',
          recordedById: actor.id,
        },
      })

      return tx.measurement.upsert({
        where: { learnerId_measuredOn: { learnerId, measuredOn } },
        create: {
          learnerId,
          heightCm: h1,
          weightKg: w1,
          measuredOn,
          note,
          recordedById: actor.id,
        },
        update: { heightCm: h1, weightKg: w1, note, recordedById: actor.id },
      })
    })

    audit({
      actorId: actor.id,
      action: 'MEASUREMENT_RECORDED',
      targetType: 'learner',
      targetId: learnerId,
      /* Ids and the session date only. The height and weight are the
         identifying health data this log must not duplicate. */
      detail: { measurementId: row.id, measuredOn: measuredOn.toISOString().slice(0, 10) },
      ipAddress: ipOf(req),
    })

    res.status(201).json({ ok: true, id: row.id })
  }),
)

/** Undo. Removes the measurement AND any absence for that session. */
recordsRouter.delete(
  '/measurements/:learnerId/:measuredOn',
  h(async (req, res) => {
    const actor = actorOf(req)
    const learnerId = String(req.params.learnerId)
    const on = IsoDate.safeParse(req.params.measuredOn)
    if (!on.success) throw badRequest('Enter a valid date.', 'INVALID_DATE')
    await assertLearnerInScope(actor, learnerId)

    const [m, a] = await db.$transaction(async (tx) => {
      /* The withdrawal is logged too, and with no figures on it: the point of
         the row is that the day's measurement was taken back, and the numbers
         it used to carry are already on the RECORDED row above it. A history
         that showed the withdrawn values again would read as though they had
         been entered a second time. */
      const had = await tx.measurement.findUnique({
        where: { learnerId_measuredOn: { learnerId, measuredOn: on.data } },
        select: { id: true },
      })
      if (had) {
        await tx.measurementRevision.create({
          data: {
            learnerId,
            measuredOn: on.data,
            kind: 'WITHDRAWN',
            recordedById: actor.id,
          },
        })
      }
      return Promise.all([
        tx.measurement.deleteMany({ where: { learnerId, measuredOn: on.data } }),
        tx.absence.deleteMany({ where: { learnerId, measuredOn: on.data } }),
      ])
    })

    audit({
      actorId: actor.id,
      action: 'MEASUREMENT_WITHDRAWN',
      targetType: 'learner',
      targetId: learnerId,
      detail: {
        measuredOn: req.params.measuredOn,
        measurements: m.count,
        absences: a.count,
      },
      ipAddress: ipOf(req),
    })

    res.status(204).end()
  }),
)

/* --- Absences ------------------------------------------------------------ */

const AbsenceBody = z.object({
  learnerId: z.string().min(1),
  measuredOn: IsoDate,
})

recordsRouter.post(
  '/absences',
  h(async (req, res) => {
    const actor = actorOf(req)
    const parsed = AbsenceBody.safeParse(req.body)
    if (!parsed.success) throw badRequest('Check the absence.', 'INVALID_BODY')
    const { learnerId, measuredOn } = parsed.data
    await assertLearnerInScope(actor, learnerId)

    const row = await db.absence.upsert({
      where: { learnerId_measuredOn: { learnerId, measuredOn } },
      create: { learnerId, measuredOn, recordedById: actor.id },
      update: { recordedById: actor.id },
    })

    audit({
      actorId: actor.id,
      action: 'LEARNER_MARKED_ABSENT',
      targetType: 'learner',
      targetId: learnerId,
      detail: { measuredOn: measuredOn.toISOString().slice(0, 10) },
      ipAddress: ipOf(req),
    })

    res.status(201).json({ ok: true, id: row.id })
  }),
)

/* --- Immunization -------------------------------------------------------- */

const IMMUNIZATION_IN = {
  complete: 'COMPLETE',
  incomplete: 'INCOMPLETE',
  none: 'NONE',
} as const

const ImmunizationBody = z.object({
  learnerId: z.string().min(1),
  status: z.enum(['complete', 'incomplete', 'none']),
  checkedOn: IsoDate,
})

recordsRouter.post(
  '/immunizations',
  h(async (req, res) => {
    const actor = actorOf(req)
    const parsed = ImmunizationBody.safeParse(req.body)
    if (!parsed.success) throw badRequest('Check the immunization entry.', 'INVALID_BODY')
    const { learnerId, status, checkedOn } = parsed.data
    await assertLearnerInScope(actor, learnerId)

    const row = await db.immunization.upsert({
      where: { learnerId_checkedOn: { learnerId, checkedOn } },
      create: {
        learnerId,
        status: IMMUNIZATION_IN[status],
        checkedOn,
        recordedById: actor.id,
      },
      update: { status: IMMUNIZATION_IN[status], recordedById: actor.id },
    })

    audit({
      actorId: actor.id,
      action: 'IMMUNIZATION_RECORDED',
      targetType: 'learner',
      targetId: learnerId,
      /* The status IS the health datum here, so unlike a height it is not
         logged - the id and the date are enough to trace who looked and
         when, which is all the audit trail is for. */
      detail: { checkedOn: checkedOn.toISOString().slice(0, 10) },
      ipAddress: ipOf(req),
    })

    res.status(201).json({ ok: true, id: row.id })
  }),
)

/* --- Slips --------------------------------------------------------------- */

const SLIP_IN = {
  'not-printed': 'NOT_PRINTED',
  printed: 'PRINTED',
  attended: 'ATTENDED',
} as const

const SlipBody = z.object({
  learnerId: z.string().min(1),
  state: z.enum(['not-printed', 'printed', 'attended']),
  /* When the transition happened. The client sends it because a batch print
     stamps every slip in the batch with one instant. A bare date is accepted
     too: clients up to 0.2.0 sent one, and refusing it failed every print
     and every scan after the PDF had already been saved. */
  at: z.union([z.string().datetime(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),
})

recordsRouter.post(
  '/slips',
  h(async (req, res) => {
    const actor = actorOf(req)
    const parsed = SlipBody.safeParse(req.body)
    if (!parsed.success) throw badRequest('Check the slip.', 'INVALID_BODY')
    const { learnerId, state } = parsed.data
    const at = parsed.data.at ? new Date(parsed.data.at) : new Date()
    await assertLearnerInScope(actor, learnerId)

    /* This year's slip. Last year's, if any, is left exactly as it was. */
    const schoolYear = await currentSchoolYear(actor.schoolId)
    const key = { learnerId_schoolYear: { learnerId, schoolYear } }
    const prev = await db.slip.findUnique({ where: key })

    /* The meeting a printed slip names is frozen onto the slip at print time.
       Re-printing re-stamps it with the meeting now in force, which is
       correct - that is the paper the parent is holding. Anything other than
       a print leaves it alone. */
    const current =
      state === 'printed'
        ? await db.meeting.findFirst({
            where: { schoolId: actor.schoolId, isCurrent: true },
            select: { id: true },
          })
        : null

    if (state === 'printed' && !current) {
      throw badRequest(
        'Set the meeting date before printing the slips.',
        'NO_MEETING',
      )
    }

    /* Attendance cannot be recorded before the meeting it is for (2026-10-14:
       a stub typed on the 14th for a meeting on the 31st would record a
       parent as present at a meeting that has not happened). The meeting is
       the one printed on this parent's slip, else the current one. On the day
       and after is allowed, so stubs collected at the door can be entered
       the next morning. */
    if (state === 'attended') {
      const m = prev?.meetingId
        ? await db.meeting.findUnique({ where: { id: prev.meetingId }, select: { date: true } })
        : await db.meeting.findFirst({
            where: { schoolId: actor.schoolId, isCurrent: true },
            select: { date: true },
          })
      const meetingDay = m?.date.toISOString().slice(0, 10)
      if (meetingDay && meetingDay > localToday()) {
        const long = m!.date.toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          timeZone: 'UTC',
        })
        throw badRequest(
          `Attendance can be recorded from ${long}, the day of the parent meeting.`,
          'MEETING_NOT_YET',
        )
      }
    }

    const row = await db.slip.upsert({
      where: key,
      create: {
        learnerId,
        schoolYear,
        state: SLIP_IN[state],
        printedAt: state === 'printed' ? at : null,
        attendedAt: state === 'attended' ? at : null,
        meetingId: current?.id ?? null,
        recordedById: actor.id,
      },
      update: {
        state: SLIP_IN[state],
        /* Only the print transition may write a print date. A scan at the
           door knows a parent arrived; it does not know when the invitation
           was run off, and stamping the scan time here would invent a fact. */
        printedAt:
          state === 'not-printed' ? null : state === 'printed' ? at : (prev?.printedAt ?? null),
        attendedAt: state === 'attended' ? at : (prev?.attendedAt ?? null),
        meetingId: state === 'printed' ? (current?.id ?? null) : (prev?.meetingId ?? null),
        recordedById: actor.id,
      },
    })

    audit({
      actorId: actor.id,
      action:
        state === 'printed'
          ? 'SLIP_PRINTED'
          : state === 'attended'
            ? 'MEETING_ATTENDANCE_RECORDED'
            : 'SLIP_WITHDRAWN',
      targetType: 'learner',
      targetId: learnerId,
      detail: { slipId: row.id, state },
      ipAddress: ipOf(req),
    })

    res.status(201).json({ ok: true, id: row.id })
  }),
)

/* --- The meeting --------------------------------------------------------- */

recordsRouter.get(
  '/meeting',
  h(async (req, res) => {
    const actor = actorOf(req)
    const m = await db.meeting.findFirst({
      where: { schoolId: actor.schoolId, isCurrent: true },
    })
    res.json({
      meeting: m
        ? { id: m.id, date: m.date.toISOString().slice(0, 10), time: m.time, venue: m.venue }
        : null,
    })
  }),
)

const MeetingBody = z.object({
  date: IsoDate,
  time: z.string().trim().min(1).max(32),
  venue: z.string().trim().min(1).max(200),
})

recordsRouter.put(
  '/meeting',
  h(async (req, res) => {
    const actor = actorOf(req)
    const parsed = MeetingBody.safeParse(req.body)
    if (!parsed.success) throw badRequest('Set a date, a time and a venue.', 'INVALID_BODY')

    /* Exactly one meeting is current. Cleared and set in one transaction so
       there is never an instant with two - a slip printed in that window
       would freeze the wrong date onto a parent's paper. */
    const m = await db.$transaction(async (tx) => {
      await tx.meeting.updateMany({
        where: { schoolId: actor.schoolId, isCurrent: true },
        data: { isCurrent: false },
      })
      return tx.meeting.create({
        data: { schoolId: actor.schoolId, isCurrent: true, ...parsed.data },
      })
    })

    audit({
      actorId: actor.id,
      action: 'MEETING_SET',
      targetType: 'meeting',
      targetId: m.id,
      detail: { date: m.date.toISOString().slice(0, 10) },
      ipAddress: ipOf(req),
    })

    res.json({
      meeting: { id: m.id, date: m.date.toISOString().slice(0, 10), time: m.time, venue: m.venue },
    })
  }),
)

/* --- Meeting history (2026-10-14) ------------------------------------------

   Every save of the meeting makes a new row and keeps the old one, and every
   printed slip carries the meeting it was printed for. So the history needs
   no table of its own: a meeting's invitations are the slips that name it,
   and its attendance is those slips marked attended.

   Listed: the current meeting, and any earlier one that had slips printed.
   A meeting replaced before anything was printed for it was a correction,
   not a meeting, and would only be noise here.

   One slip per learner per school year means a parent invited again for a
   later meeting moves to that meeting; the earlier one then counts one
   fewer. That is the data model's limit, not this route's. */

const meetingOut = (m: { id: string; date: Date; time: string; venue: string; isCurrent: boolean }) => ({
  id: m.id,
  date: m.date.toISOString().slice(0, 10),
  time: m.time,
  venue: m.venue,
  isCurrent: m.isCurrent,
})

recordsRouter.get(
  '/meetings',
  h(async (req, res) => {
    const actor = actorOf(req)
    const meetings = await db.meeting.findMany({
      where: { schoolId: actor.schoolId },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        date: true,
        time: true,
        venue: true,
        isCurrent: true,
        slips: {
          /* A withdrawn slip still names its meeting; it is not an invitation. */
          where: { state: { not: 'NOT_PRINTED' }, learner: { ...learnerScope(actor) } },
          select: { state: true },
        },
      },
    })
    res.json({
      meetings: meetings
        .filter((m) => m.isCurrent || m.slips.length > 0)
        .map((m) => ({
          ...meetingOut(m),
          invited: m.slips.length,
          attended: m.slips.filter((s) => s.state === 'ATTENDED').length,
        })),
    })
  }),
)

recordsRouter.get(
  '/meetings/:id',
  h(async (req, res) => {
    const actor = actorOf(req)
    const m = await db.meeting.findFirst({
      where: { id: req.params.id, schoolId: actor.schoolId },
      select: { id: true, date: true, time: true, venue: true, isCurrent: true },
    })
    if (!m) throw notFound('That meeting was not found.', 'NO_MEETING')

    const slips = await db.slip.findMany({
      where: { meetingId: m.id, state: { not: 'NOT_PRINTED' }, learner: { ...learnerScope(actor) } },
      select: {
        state: true,
        attendedAt: true,
        learner: {
          select: {
            id: true,
            firstName: true,
            middleName: true,
            lastName: true,
            stubId: true,
            section: { select: { name: true, gradeLevel: { select: { level: true } } } },
          },
        },
      },
    })

    res.json({
      meeting: meetingOut(m),
      invited: slips.length,
      attendees: slips
        .filter((s) => s.state === 'ATTENDED')
        .sort((a, b) => (b.attendedAt?.getTime() ?? 0) - (a.attendedAt?.getTime() ?? 0))
        .map((s) => ({
          learnerId: s.learner.id,
          name: `${s.learner.lastName}, ${s.learner.firstName}${s.learner.middleName ? ` ${s.learner.middleName[0]}.` : ''}`,
          section: s.learner.section.name,
          stubId: s.learner.stubId,
          attendedAt: s.attendedAt?.toISOString() ?? null,
        })),
    })
  }),
)

/* --- The follow-up weigh-in -----------------------------------------------

   An extra weigh-in for a chosen set of learners (usually the ones who need
   monitoring), between the baseline and the endline. It stores only who is
   expected and from which date: measurements stay plain dated rows, so the
   baseline and endline that the SF8 reads are untouched. One is open at a
   time. Added 2026-10-11. */

const toFollowUp = (f: { id: string; label: string; startedOn: Date; learnerIds: string[]; closedAt: Date | null }) => ({
  id: f.id,
  label: f.label,
  startedOn: f.startedOn.toISOString().slice(0, 10),
  learnerIds: f.learnerIds,
  closedAt: f.closedAt ? f.closedAt.toISOString() : null,
})

recordsRouter.get(
  '/follow-up',
  h(async (req, res) => {
    const actor = actorOf(req)
    const f = await db.followUpWeighIn.findFirst({
      where: { schoolId: actor.schoolId, closedAt: null },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ followUp: f ? toFollowUp(f) : null })
  }),
)

const FollowUpBody = z.object({
  label: z.string().trim().min(1).max(80).default('Follow-up weigh-in'),
  startedOn: IsoDate,
  learnerIds: z.array(z.string().min(1)).min(1).max(5000),
})

recordsRouter.post(
  '/follow-up',
  h(async (req, res) => {
    const actor = actorOf(req)
    const parsed = FollowUpBody.safeParse(req.body)
    if (!parsed.success) throw badRequest('Choose at least one learner and a start date.', 'INVALID_BODY')

    /* Only learners this account can see, and only once each. */
    const ids = [...new Set(parsed.data.learnerIds)]
    const known = await db.learner.findMany({
      where: { ...learnerScope(actor), id: { in: ids }, archivedAt: null },
      select: { id: true },
    })
    if (known.length === 0) throw badRequest('None of the chosen learners were found.', 'NO_LEARNERS')

    /* Starting a new one ends the open one, in one transaction, so there is
       never a moment with two. */
    const f = await db.$transaction(async (tx) => {
      await tx.followUpWeighIn.updateMany({
        where: { schoolId: actor.schoolId, closedAt: null },
        data: { closedAt: new Date() },
      })
      return tx.followUpWeighIn.create({
        data: {
          schoolId: actor.schoolId,
          label: parsed.data.label,
          startedOn: parsed.data.startedOn,
          learnerIds: known.map((k) => k.id),
          createdById: actor.id,
        },
      })
    })

    audit({
      actorId: actor.id,
      action: 'FOLLOW_UP_STARTED',
      targetType: 'follow_up_weigh_in',
      targetId: f.id,
      detail: { startedOn: f.startedOn.toISOString().slice(0, 10), learners: f.learnerIds.length },
      ipAddress: ipOf(req),
    })

    res.status(201).json({ followUp: toFollowUp(f) })
  }),
)

recordsRouter.post(
  '/follow-up/close',
  h(async (req, res) => {
    const actor = actorOf(req)
    const open = await db.followUpWeighIn.findFirst({
      where: { schoolId: actor.schoolId, closedAt: null },
    })
    if (!open) throw notFound('There is no follow-up weigh-in in progress.', 'NO_FOLLOW_UP')
    const f = await db.followUpWeighIn.update({ where: { id: open.id }, data: { closedAt: new Date() } })

    audit({
      actorId: actor.id,
      action: 'FOLLOW_UP_ENDED',
      targetType: 'follow_up_weigh_in',
      targetId: f.id,
      detail: { learners: f.learnerIds.length },
      ipAddress: ipOf(req),
    })

    res.json({ followUp: null })
  }),
)

/* --- The activity feed --------------------------------------------------- */

/* What has been done, newest first, scoped like everything else. This is the
   dashboard's "Recent Activity" - which on the desktop build was assembled by
   the client from its own file, and could therefore only ever show what THIS
   laptop had done. Over an API a head sees the whole school's activity, which
   is the first thing on that panel that a single-laptop install could not
   have told her. */
recordsRouter.get(
  '/activity',
  h(async (req, res) => {
    const actor = actorOf(req)
    const limit = Math.min(Number(req.query.limit) || 20, 100)
    const scope = learnerScope(actor)

    const entries = await db.auditEntry.findMany({
      where: {
        targetType: 'learner',
        action: {
          in: [
            'MEASUREMENT_RECORDED',
            'LEARNER_MARKED_ABSENT',
            'IMMUNIZATION_RECORDED',
            'SLIP_PRINTED',
            'MEETING_ATTENDANCE_RECORDED',
          ],
        },
        /* The audit table carries no school column, so the learner join is
           what limits it to this school's children. */
        targetId: {
          in: (
            await db.learner.findMany({ where: scope, select: { id: true } })
          ).map((l) => l.id),
        },
      },
      orderBy: { at: 'desc' },
      take: limit,
      include: { actor: { select: { fullName: true } } },
    })

    if (entries.length === 0) return res.json({ events: [] })

    const learners = await db.learner.findMany({
      where: { id: { in: entries.map((e) => e.targetId!).filter(Boolean) } },
      select: { id: true, lastName: true, firstName: true },
    })
    const byId = new Map(learners.map((l) => [l.id, l]))

    res.json({
      events: entries.map((e) => ({
        action: e.action,
        at: e.at.toISOString(),
        learnerId: e.targetId,
        learner: byId.get(e.targetId ?? '') ?? null,
        by: e.actor?.fullName ?? null,
      })),
    })
  }),
)

/* --- One learner, archived ----------------------------------------------- */

recordsRouter.post(
  '/learners/:id/archive',
  h(async (req, res) => {
    const actor = actorOf(req)
    const id = String(req.params.id)
    await assertLearnerInScope(actor, id)

    const l = await db.learner.update({ where: { id }, data: { archivedAt: new Date() } })
    if (!l) throw notFound()

    audit({
      actorId: actor.id,
      action: 'LEARNER_ARCHIVED',
      targetType: 'learner',
      targetId: id,
      ipAddress: ipOf(req),
    })

    res.status(204).end()
  }),
)

/** Today on this computer's calendar, as YYYY-MM-DD. The server runs on the
    school's own machine, so its local date is the school's date. */
function localToday(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
