import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowLeft, CalendarBlank, CaretRight, Check, Clock, MagnifyingGlass, UsersThree, X } from '@phosphor-icons/react'
import { cx } from '../components/ui'
import { Y } from '../components/bento'
import { TODAY, fullName, type Learner } from '../data/mock'
import { useRoster } from '../lib/records'
import { formatDate } from '../lib/dates'
import { endpoints } from '../lib/api'
import { useQuery } from '../lib/query'

/* The meeting door. The nurse types the Stub ID printed on the stub a parent
   hands over, and attended_at is stamped. Typed only: scanning and the QR on
   the slip were dropped at the user's request (2026-10-14).

   The layout is the "check-in gate" draft, chosen by the user at a smaller
   size (2026-10-12): a navy card holding the Stub ID field and the result of
   the last entry, and under it the meeting history: each meeting, and who
   attended it when selected. Read from the saved records, so it is the same
   after leaving the screen or restarting CHAS (2026-10-14).

   NOT BEFORE THE MEETING (2026-10-14). A stub typed on the 14th for a
   meeting on the 31st would record a parent as present at a meeting that has
   not happened. Before the meeting day the field is closed and says when it
   opens; the server refuses it too (routes/records.ts). On the day and after
   is allowed, so stubs collected at the door can be entered the next
   morning.

   LOST STUB (2026-10-19). A parent who lost the slip is found by name or
   LRN instead: "Stub lost? Find by name" swaps the Stub ID field for a
   search over the invited learners, and each match records attendance
   with the same checks as a typed stub. */

type Result =
  | { kind: 'ok'; name: string; grade: string; stub: string; at: string }
  | { kind: 'dupe'; name: string; grade: string; stub: string; on: string }
  | { kind: 'early'; name: string; stub: string; on: string }
  | { kind: 'unknown'; stub: string }

export default function Attendance() {
  const { learners, setSlip, meeting } = useRoster()
  const [code, setCode] = useState('')
  const [last, setLast] = useState<{ r: Result; id?: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const notYet = meeting !== null && meeting.date > TODAY
  const closed = !meeting || notYet

  /* Stub lost: search by name or LRN instead of the stub ID. */
  const [byName, setByName] = useState(false)
  const [name, setName] = useState('')
  const matches = useMemo(() => {
    const needle = name.trim().toLowerCase()
    if (!needle) return []
    return learners
      .filter((l) => l.slip !== 'not-printed')
      .filter(
        (l) =>
          fullName(l).toLowerCase().includes(needle) ||
          `${l.firstName} ${l.lastName}`.toLowerCase().includes(needle) ||
          l.lrn.includes(needle),
      )
      .sort((a, b) => fullName(a).localeCompare(fullName(b)))
      .slice(0, 6)
  }, [learners, name])

  function submit(e: FormEvent) {
    e.preventDefault()
    if (closed) return
    const stub = code.trim().toUpperCase()
    if (!stub) return
    check(
      learners.find((l) => l.stubId === stub),
      stub,
    )
    setCode('')
    inputRef.current?.focus()
  }

  function pick(l: Learner) {
    if (closed) return
    check(l, l.stubId)
    setName('')
    setByName(false)
  }

  function check(hit: Learner | undefined, stub: string) {
    let r: Result
    let id: string | undefined
    if (!hit || hit.slip === 'not-printed') {
      /* A real stub for a learner who was never invited means the roster and
         the paper disagree, and silently stamping it would hide that. */
      r = { kind: 'unknown', stub }
    } else if (hit.slip === 'attended') {
      /* Entering the same stub twice is not an error worth stopping for - a
         parent hands the stub over twice, or it is typed again by mistake. It is
         reported and ignored rather than re-stamped, so the first arrival
         stays the one on record. */
      r = {
        kind: 'dupe',
        name: fullName(hit),
        grade: hit.section,
        stub,
        on: formatDate(hit.attendedAt) || 'today',
      }
      id = hit.id
    } else if (hit.slipMeeting?.date && hit.slipMeeting.date > TODAY) {
      /* This parent's slip names a later meeting than today. */
      r = {
        kind: 'early',
        name: fullName(hit),
        stub,
        on: longDate(hit.slipMeeting.date),
      }
    } else {
      setSlip(hit.id, 'attended', TODAY)
      r = {
        kind: 'ok',
        name: fullName(hit),
        grade: hit.section,
        stub,
        at: clock(),
      }
      id = hit.id
    }
    setLast({ r, id })
  }

  return (
    <div className="h-full overflow-auto px-6 pt-1 pb-6">
      <div className="mx-auto grid min-h-full max-w-[980px] grid-cols-1 gap-4 xl:h-full">
        <div className="flex min-h-0 min-w-0 flex-col gap-4">
          {/* --- The gate ------------------------------------------------------ */}
          <section
            className="shrink-0 rounded-[20px] px-5 pt-4 pb-5 text-white"
            style={{
              background: 'linear-gradient(135deg, #2b52c4 0%, #1b3a92 55%, #0e2464 100%)',
            }}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <label htmlFor={byName ? 'find' : 'stub'} className="text-[12px] font-semibold text-white/75">
                {byName ? 'Find the learner by name or LRN' : 'Stub ID'}
              </label>
              <span className="text-[11.5px] text-white/70">
                {meeting ? `Parent meeting · ${meetingText(meeting.date)} · ${meeting.time} · ${meeting.venue}` : 'No parent meeting set'}
              </span>
            </div>
            {byName ? (
              <div className="mt-2">
                <div className="relative">
                  <MagnifyingGlass
                    size={16}
                    weight="bold"
                    className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted"
                  />
                  <input
                    id="find"
                    autoFocus
                    autoComplete="off"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Type the learner's name or LRN"
                    className="h-12 w-full rounded-[12px] bg-white pr-4 pl-10 text-[15px] font-semibold text-navy-900 placeholder:text-[13px] placeholder:font-normal placeholder:text-placeholder focus:shadow-[0_0_0_3px_rgba(255,222,23,0.55)] focus:outline-none"
                  />
                </div>
                {name.trim() && (
                  <ul className="mt-2 overflow-hidden rounded-[14px] bg-white text-navy-900">
                    {matches.length === 0 ? (
                      <li className="px-4 py-3 text-[12.5px] text-muted">No invited learner matches this name.</li>
                    ) : (
                      matches.map((l) => (
                        <li key={l.id} className="flex items-center gap-3 border-b border-line-soft px-4 py-2.5 last:border-b-0">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13.5px] font-semibold">{fullName(l)}</span>
                            <span className="block truncate text-[11.5px] text-muted">
                              {l.section} · Stub {l.stubId}
                              {l.slip === 'attended' ? ' · Attended' : ''}
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => pick(l)}
                            className="h-9 shrink-0 rounded-[10px] px-4 text-[12.5px] font-bold text-[#071539] transition-[filter] duration-100 hover:brightness-95 active:translate-y-px"
                            style={{ background: Y }}
                          >
                            Record attendance
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </div>
            ) : (
              <form onSubmit={submit} className="mt-2 flex gap-2">
                <input
                  id="stub"
                  ref={inputRef}
                  autoFocus
                  autoComplete="off"
                  disabled={closed}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={closed ? 'Attendance is not open yet' : 'Type the stub ID, for example G3-0028'}
                  className="tnum h-12 min-w-0 flex-1 rounded-[12px] bg-white px-4 text-[16px] font-semibold tracking-[0.05em] text-navy-900 uppercase placeholder:text-[13px] placeholder:font-normal placeholder:tracking-normal placeholder:normal-case placeholder:text-placeholder focus:shadow-[0_0_0_3px_rgba(255,222,23,0.55)] focus:outline-none disabled:cursor-not-allowed disabled:bg-white/80"
                />
                <button
                  type="submit"
                  disabled={closed}
                  className="h-12 shrink-0 rounded-[12px] px-5 text-[13px] font-bold text-[#071539] transition-[filter] duration-100 enabled:hover:brightness-95 enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ background: Y }}
                >
                  Record attendance
                </button>
              </form>
            )}

            {!closed && (
              <button
                type="button"
                onClick={() => {
                  setByName((v) => !v)
                  setName('')
                }}
                className="mt-2 text-[12px] font-semibold text-white/80 underline-offset-2 hover:text-white hover:underline"
              >
                {byName ? 'Use the stub ID' : 'Stub lost? Find by name'}
              </button>
            )}

            {closed ? (
              <div className="mt-4 flex items-center gap-4 rounded-[16px] bg-white px-5 py-4 text-navy-900">
                <Badge className="bg-navy-50 text-navy-700">
                  <CalendarBlank size={24} weight="bold" />
                </Badge>
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold">
                    {meeting ? `Attendance opens on ${longDate(meeting.date)}` : 'No parent meeting set'}
                  </div>
                  <div className="mt-0.5 text-[12px] text-muted">
                    {meeting
                      ? 'Attendance can be recorded on the day of the parent meeting.'
                      : 'Set the parent meeting on the Invitation slips page.'}
                  </div>
                </div>
              </div>
            ) : (
              last && (
                <div className="mt-4 flex items-center gap-4 rounded-[16px] bg-white px-5 py-4 text-navy-900">
                  <LastResult r={last.r} />
                </div>
              )
            )}
          </section>

          {/* --- Meeting history ----------------------------------------------- */}
          <MeetingHistory latestId={last?.id} />
        </div>
      </div>
    </div>
  )
}

/* --- Meeting history (2026-10-14, the user's request) --------------------------
   Every parent meeting that had slips printed for it, newest first, each with
   how many invited parents attended. Selecting one shows who attended it.
   Read from the server (routes/records.ts, /meetings), so it is the same on
   any day; recording a stub refreshes it, because every write clears the
   query cache. */

function MeetingHistory({ latestId }: { latestId?: string }) {
  const list = useQuery('meetings', endpoints.meetings)
  const [openId, setOpenId] = useState<string | null>(null)
  const meetings = list.data?.meetings ?? []

  if (openId) return <MeetingAttendees id={openId} latestId={latestId} onBack={() => setOpenId(null)} />

  return (
    <section className="panel flex min-h-[200px] flex-1 flex-col overflow-hidden">
      <div className="flex items-baseline justify-between px-5 pt-4 pb-2">
        <h3 className="text-[13.5px] font-semibold text-navy-900">Meeting history</h3>
        <span className="tnum text-[11.5px] text-muted">
          {meetings.length} meeting{meetings.length === 1 ? '' : 's'}
        </span>
      </div>
      {list.loading && meetings.length === 0 ? (
        <p className="px-5 pt-2 pb-5 text-[12px] text-muted">Loading meetings…</p>
      ) : meetings.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-5 pb-8 text-center">
          <CalendarBlank size={28} className="text-placeholder" />
          <p className="mt-2 text-[12.5px] text-muted">No parent meetings yet.</p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-auto px-3 pb-3">
          {meetings.map((m) => {
            const d = new Date(`${m.date}T00:00`)
            const share = m.invited ? m.attended / m.invited : 0
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(m.id)}
                  className="flex w-full items-center gap-3.5 rounded-[12px] px-2 py-2.5 text-left transition-colors duration-100 hover:bg-wash"
                >
                  <span className="grid w-12 shrink-0 place-items-center rounded-[10px] bg-navy-50 py-1.5 text-navy-800">
                    <span className="text-[10px] font-semibold tracking-[0.06em] uppercase">
                      {d.toLocaleDateString('en-US', { month: 'short' })}
                    </span>
                    <span className="tnum text-[18px] leading-none font-bold">{d.getDate()}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold text-navy-900">{longDate(m.date)}</span>
                      {m.isCurrent && (
                        <span className="shrink-0 rounded-full bg-[#fff6c2] px-2 py-0.5 text-[10px] font-semibold text-[#6b5800]">
                          {m.date >= TODAY ? 'Upcoming' : 'Current'}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-[11.5px] text-muted">
                      {m.time} · {m.venue}
                    </span>
                  </span>
                  <span className="w-[150px] shrink-0">
                    <span className="tnum block text-right text-[12px] font-semibold text-navy-900">
                      {m.attended} of {m.invited} attended
                    </span>
                    <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-navy-50">
                      <span className="block h-full rounded-full bg-[#2f9e5b]" style={{ width: `${share * 100}%` }} />
                    </span>
                  </span>
                  <CaretRight size={14} weight="bold" className="shrink-0 text-placeholder" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function MeetingAttendees({ id, latestId, onBack }: { id: string; latestId?: string; onBack: () => void }) {
  const q = useQuery(`meeting:${id}`, () => endpoints.meetingDetail(id))
  const detail = q.data

  return (
    <section className="panel flex min-h-[200px] flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-4 pt-3.5 pb-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to meeting history"
          className="grid size-8 shrink-0 place-items-center rounded-full bg-wash text-navy-800 transition-colors duration-100 hover:bg-navy-50"
        >
          <ArrowLeft size={14} weight="bold" />
        </button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13.5px] font-semibold text-navy-900">{detail ? longDate(detail.meeting.date) : 'Meeting'}</h3>
          {detail && (
            <div className="truncate text-[11.5px] text-muted">
              {detail.meeting.time} · {detail.meeting.venue}
            </div>
          )}
        </div>
        {detail && (
          <span className="tnum shrink-0 text-[11.5px] text-muted">
            {detail.attendees.length} of {detail.invited} attended
          </span>
        )}
      </div>

      {!detail ? (
        <p className="px-5 pt-2 pb-5 text-[12px] text-muted">{q.error ? 'Unable to load this meeting.' : 'Loading…'}</p>
      ) : detail.attendees.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-5 pb-8 text-center">
          <UsersThree size={28} className="text-placeholder" />
          <p className="mt-2 text-[12.5px] text-muted">No attendance recorded for this meeting.</p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-auto px-3 pb-3">
          {detail.attendees.map((a) => {
            const latest = latestId === a.learnerId
            return (
              <li key={a.learnerId} className={cx('flex items-center gap-3 rounded-[10px] px-2 py-2 text-[12px]', latest && 'bg-wash')}>
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#e6f4ec] text-[#136c34]">
                  <Check size={14} weight="bold" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-medium text-navy-900">{a.name}</div>
                  <div className="text-[11px] text-muted">{a.section}</div>
                </div>
                {latest && (
                  <span className="shrink-0 rounded-full bg-navy-50 px-2 py-0.5 text-[10px] font-semibold text-navy-700">Latest</span>
                )}
                <span className="w-[92px] shrink-0 text-right text-[11px] text-muted">{attendedText(a.attendedAt)}</span>
                <span className="w-[64px] shrink-0 text-right font-mono text-[10.5px] text-muted">{a.stubId}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/* --- Pieces ------------------------------------------------------------------ */

function LastResult({ r }: { r: Result }) {
  const look = {
    ok: {
      badge: 'bg-[#e6f4ec] text-[#136c34]',
      icon: <Check size={24} weight="bold" />,
      label: 'Attended',
      tone: 'text-[#136c34]',
    },
    dupe: {
      badge: 'bg-gold-100 text-gold-700',
      icon: <Clock size={24} weight="bold" />,
      label: 'Already recorded',
      tone: 'text-gold-700',
    },
    early: {
      badge: 'bg-gold-100 text-gold-700',
      icon: <CalendarBlank size={24} weight="bold" />,
      label: 'Meeting not yet held',
      tone: 'text-gold-700',
    },
    unknown: {
      badge: 'bg-[#fdf2f5] text-[#be123c]',
      icon: <X size={24} weight="bold" />,
      label: 'No invitation found',
      tone: 'text-[#be123c]',
    },
  }[r.kind]
  return (
    <>
      <Badge className={look.badge}>{look.icon}</Badge>
      <div className="min-w-0">
        <div className={cx('text-[11px] font-bold tracking-[0.1em] uppercase', look.tone)}>{look.label}</div>
        <div className="mt-0.5 truncate text-[22px] leading-tight font-bold tracking-[-0.01em]">
          {r.kind === 'unknown' ? r.stub : r.name}
        </div>
        <div className="mt-0.5 truncate text-[12px] text-muted">
          {r.kind === 'ok' && `${r.grade} · Stub ${r.stub} · ${r.at}`}
          {r.kind === 'dupe' && `${r.grade} · Stub ${r.stub} · attended ${r.on}`}
          {r.kind === 'early' && `This slip is for the meeting on ${r.on}. Record it on that day.`}
          {r.kind === 'unknown' && 'Check the stub ID, or confirm the learner was invited.'}
        </div>
      </div>
    </>
  )
}

function Badge({ className, children }: { className: string; children: ReactNode }) {
  return <span className={cx('grid size-12 shrink-0 place-items-center rounded-full', className)}>{children}</span>
}

function clock(): string {
  return new Date().toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** "Today, 10:50 AM", or "Oct 13, 10:50 AM" on another day. */
function attendedText(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const time = /T/.test(iso) ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''
  const day = iso.slice(0, 10) === TODAY ? 'Today' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return time ? `${day}, ${time}` : day
}

function meetingText(iso: string): string {
  const d = new Date(`${iso}T00:00`)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
}

/** "Saturday, October 31". */
function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00`)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
}
