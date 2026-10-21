/* The school itself: its name and the other details the SF8 header and the
   invitation slip print, and its logo.

   These used to be constants in src/data/school.ts, which meant a second
   school adopting CHAS had to change the code. Since 2026-10-15 they are a
   row the head edits in School settings, so one build serves any school.
   The constants remain only as what a first launch starts with.

   READING IS PUBLIC. The sign-in screen prints the school's name and logo
   before anybody has signed in, and both are on every slip that goes home;
   nothing here is not already on that screen. WRITING IS THE HEAD'S. */

import express, { Router } from 'express'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '../db.js'
import { audit } from '../lib/audit.js'
import { badRequest, conflict, notFound } from '../lib/errors.js'
import { h, ipOf } from '../lib/http.js'
import { actorOf, requireAdmin, requireAuth } from '../auth/middleware.js'

export const schoolRouter = Router()

/** The school's details as every client reads them. */
export function schoolIdentity(s: {
  name: string
  depedId: string | null
  district: string
  division: string
  region: string
  logoUpdatedAt: Date | null
}) {
  return {
    name: s.name,
    schoolId: s.depedId ?? '',
    district: s.district,
    division: s.division,
    region: s.region,
    /* Changes whenever the logo does, so the client can put it in the
       logo's URL and never be served a stale one from cache. Null: the
       logo shipped with the app. */
    logoVersion: s.logoUpdatedAt ? String(s.logoUpdatedAt.getTime()) : null,
  }
}

export const IDENTITY_SELECT = {
  name: true,
  depedId: true,
  district: true,
  division: true,
  region: true,
  logoUpdatedAt: true,
} as const

/* One school per install: the first one created. Signed-in routes scope by
   the actor's school instead. */
const firstSchool = () => db.school.findFirst({ orderBy: { createdAt: 'asc' } })

schoolRouter.get(
  '/',
  h(async (_req, res) => {
    const s = await db.school.findFirst({ orderBy: { createdAt: 'asc' }, select: { ...IDENTITY_SELECT, schoolYear: true } })
    if (!s) throw notFound('The school has not been set up yet.', 'NO_SCHOOL')
    res.json({ school: schoolIdentity(s), schoolYear: s.schoolYear })
  }),
)

schoolRouter.get(
  '/logo',
  h(async (_req, res) => {
    const s = await firstSchool()
    if (!s?.logo) throw notFound('No logo has been uploaded.', 'NO_LOGO')
    res.setHeader('Content-Type', s.logoType ?? 'image/png')
    /* The URL carries ?v=<logoVersion>, so a cached copy is never stale. */
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.send(Buffer.from(s.logo))
  }),
)

/* --- The head's edits ----------------------------------------------------- */

const text = (label: string, max: number) =>
  z.string().trim().min(1, `Enter the ${label}.`).max(max, `The ${label} is too long.`)

const Details = z.object({
  name: text('school name', 120),
  /* A DepEd School ID is six digits. Optional: a school without its ID on
     file leaves the SF8 cell blank rather than printing a guess. */
  schoolId: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{6}$/.test(v), 'The School ID must be 6 digits.'),
  district: text('district', 80),
  division: text('division', 80),
  region: text('region', 80),
})

schoolRouter.put(
  '/',
  requireAuth,
  requireAdmin,
  h(async (req, res) => {
    const actor = actorOf(req)
    const parsed = Details.safeParse(req.body)
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message ?? 'Check the school details.', 'INVALID_BODY')
    }
    const d = parsed.data
    const depedId = d.schoolId || null
    if (depedId) {
      const clash = await db.school.findFirst({
        where: { depedId, id: { not: actor.schoolId } },
        select: { id: true },
      })
      if (clash) throw conflict('That School ID belongs to another school.', 'SCHOOL_ID_TAKEN')
    }
    const s = await db.school.update({
      where: { id: actor.schoolId },
      data: { name: d.name, depedId, district: d.district, division: d.division, region: d.region },
      select: IDENTITY_SELECT,
    })
    audit({
      actorId: actor.id,
      action: 'SCHOOL_UPDATED',
      targetType: 'school',
      targetId: actor.schoolId,
      detail: {},
      ipAddress: ipOf(req),
    })
    res.json({ school: schoolIdentity(s) })
  }),
)

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/* The logo arrives as the PNG itself, not JSON: the browser has already
   scaled it to at most 512px, and base64 in a JSON body would be a third
   larger and over the API's 64kb JSON limit. */
schoolRouter.put(
  '/logo',
  requireAuth,
  requireAdmin,
  express.raw({ type: 'image/png', limit: '1mb' }),
  h(async (req, res) => {
    const actor = actorOf(req)
    const body = req.body
    if (!Buffer.isBuffer(body) || body.length < PNG.length || !PNG.every((b, i) => body[i] === b)) {
      throw badRequest('Choose a PNG or JPG image.', 'INVALID_IMAGE')
    }
    const s = await db.school.update({
      where: { id: actor.schoolId },
      data: { logo: new Uint8Array(body), logoType: 'image/png', logoUpdatedAt: new Date() },
      select: IDENTITY_SELECT,
    })
    audit({
      actorId: actor.id,
      action: 'SCHOOL_LOGO_UPDATED',
      targetType: 'school',
      targetId: actor.schoolId,
      detail: { bytes: body.length },
      ipAddress: ipOf(req),
    })
    res.json({ school: schoolIdentity(s) })
  }),
)

/* Back to the logo shipped with the app. */
schoolRouter.delete(
  '/logo',
  requireAuth,
  requireAdmin,
  h(async (req, res) => {
    const actor = actorOf(req)
    const s = await db.school.update({
      where: { id: actor.schoolId },
      data: { logo: null, logoType: null, logoUpdatedAt: null },
      select: IDENTITY_SELECT,
    })
    audit({
      actorId: actor.id,
      action: 'SCHOOL_LOGO_REMOVED',
      targetType: 'school',
      targetId: actor.schoolId,
      detail: {},
      ipAddress: ipOf(req),
    })
    res.json({ school: schoolIdentity(s) })
  }),
)

/* --- The invitation slip's wording ---------------------------------------
   Edited by the head or the nurse - both print slips - on the Slips screen.
   Stored with the school, so every computer and both roles print the same
   letter. Only the fixed wording: the learner's name, class and Stub ID and
   the meeting's date, time and venue are filled in on each slip. Null means
   the wording shipped with the app, which lives in the client
   (src/lib/slip-text.ts) beside the sheet that prints it. */

/* Limits keep the letter on its half-sheet: the defaults are about 60% of
   each. */
const SlipText = z.object({
  title: text('title', 40),
  subtitle: text('English title', 60),
  message: text('message', 520),
  messageEn: text('English message', 420),
  closing: text('closing', 40),
  signer: text('signer', 40),
})

schoolRouter.put(
  '/slip-text',
  requireAuth,
  h(async (req, res) => {
    const actor = actorOf(req)
    const parsed = SlipText.safeParse(req.body)
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message ?? 'Check the slip wording.', 'INVALID_BODY')
    }
    const s = await db.school.update({
      where: { id: actor.schoolId },
      data: { slipText: parsed.data },
      select: { slipText: true },
    })
    audit({
      actorId: actor.id,
      action: 'SLIP_TEXT_UPDATED',
      targetType: 'school',
      targetId: actor.schoolId,
      detail: {},
      ipAddress: ipOf(req),
    })
    res.json({ slipText: s.slipText })
  }),
)

/* Back to the wording shipped with the app. */
schoolRouter.delete(
  '/slip-text',
  requireAuth,
  h(async (req, res) => {
    const actor = actorOf(req)
    await db.school.update({
      where: { id: actor.schoolId },
      data: { slipText: Prisma.DbNull },
    })
    audit({
      actorId: actor.id,
      action: 'SLIP_TEXT_RESET',
      targetType: 'school',
      targetId: actor.schoolId,
      detail: {},
      ipAddress: ipOf(req),
    })
    res.json({ slipText: null })
  }),
)
