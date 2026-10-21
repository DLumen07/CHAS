import { useLayoutEffect, useRef } from 'react'
import { Scissors } from '@phosphor-icons/react'
import { type Learner, fullName } from '../data/mock'
import { type Meeting } from '../lib/records'
import { useSchool, useSlipText } from '../lib/school-year'
import { boldRuns, type SlipText } from '../lib/slip-text'
import { Seal } from './Seal'

/* The invitation slip: one 8.5in × 5.5in half-sheet, bilingual, with a
   tear-off attendance stub. The same markup goes to the printer under the
   @page rule in index.css.

   This sheet used to be an advisory - it stated the finding and asked for a
   signature saying the finding had been read. It is an invitation now: it
   names a date, a time and a place, and the stub is what the parent hands
   over on arrival. The difference matters to the school, because a signed
   receipt proves the letter got home and nothing more, while the school
   needs to know who actually came.

   The look is a formal school letter, chosen by the user over a ticket and a
   step-by-step layout (2026-10-08): a centred letterhead over a double rule,
   a serif title, the letter on the left and the meeting in a ruled table on
   the right, signed off by the school nurse. Colour is held to the navy
   rules and lettering, so it reads the same on a black-and-white printer and
   costs almost no ink. */

/* The meeting date, as a parent reads it rather than as the column stores it.
   Filipino month names and the weekday in brackets, which is how the school
   writes a letter home: "Setyembre 15, 2026 (Martes)".

   This is why the meeting bar can be an ordinary date picker. The database
   wants YYYY-MM-DD and a parent does not, and doing the translation here -
   once, at the moment of printing - is what lets both have what they want.
   A date that will not parse is printed as it came, because a slip with a
   strange date on it is still better than a slip with a blank line. */
const BUWAN = [
  'Enero',
  'Pebrero',
  'Marso',
  'Abril',
  'Mayo',
  'Hunyo',
  'Hulyo',
  'Agosto',
  'Setyembre',
  'Oktubre',
  'Nobyembre',
  'Disyembre',
]
const ARAW = ['Linggo', 'Lunes', 'Martes', 'Miyerkules', 'Huwebes', 'Biyernes', 'Sabado']

export function meetingDateText(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const d = new Date(`${iso}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return iso
  return `${BUWAN[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} (${ARAW[d.getUTCDay()]})`
}

const NAVY = '#0e2464'
/* Windows ships Georgia and Times New Roman, so the letter's serif is there
   on every school laptop without bundling a font. */
const SERIF = "Georgia, 'Times New Roman', serif"

export default function SlipSheet({
  learner,
  meeting,
  text,
  onOverflow,
}: {
  learner: Learner
  /** The meeting this slip invites the parent to. Null only in the on-screen
      preview before one has been set; printing is blocked until it is. */
  meeting: Meeting | null
  /** The wording to print. Defaults to the school's saved wording; the
      wording editor passes its draft, so the preview is what will print. */
  text?: SlipText
  /** Told whether the letter is longer than its space on the sheet, so the
      wording editor can say so before anything is saved. */
  onOverflow?: (over: boolean) => void
}) {
  const name = fullName(learner)
  const school = useSchool()
  const saved = useSlipText()
  const t = text ?? saved

  const letter = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = letter.current
    if (el && onOverflow) onOverflow(el.scrollHeight > el.clientHeight + 1)
  })

  return (
    <div
      className="print-sheet mx-auto flex flex-col border border-line bg-white text-[#1f2937] shadow-[0_2px_8px_rgba(15,35,70,0.08)]"
      style={{ width: '8.5in', height: '5.5in', padding: '0.28in 0.45in 0.22in' }}
    >
      {/* --- Letterhead: centred, over a double rule ------------------------ */}
      <header className="flex items-center justify-center gap-3 pb-1.5">
        <Seal size={44} />
        <div className="text-center leading-tight">
          <div className="text-[8.5px] tracking-[0.06em] text-[#4b5563] uppercase">
            Republic of the Philippines · Department of Education
          </div>
          <div className="mt-[1px] text-[17px] font-bold" style={{ color: NAVY, fontFamily: SERIF }}>
            {school.name}
          </div>
          <div className="text-[9px] text-[#4b5563]">
            {school.district}, {school.division}
          </div>
        </div>
        {/* Balances the seal so the school name sits on the page's centre. */}
        <span aria-hidden className="w-[44px] shrink-0" />
      </header>
      <div style={{ borderTop: `2px solid ${NAVY}` }} />
      <div className="mt-[2px]" style={{ borderTop: `0.75px solid ${NAVY}` }} />

      <div className="mt-2 text-center leading-tight">
        <div className="text-[15px] font-bold tracking-[0.14em]" style={{ color: NAVY, fontFamily: SERIF }}>
          {t.title}
        </div>
        <div className="text-[9px] text-[#4b5563] italic">{t.subtitle}</div>
      </div>

      {/* --- The letter, and the meeting beside it -------------------------- */}
      <div className="mt-2 flex min-h-0 flex-1 gap-[0.25in]">
        {/* Clipped rather than pushing the stub off the sheet; the wording
            editor warns before it gets that far. */}
        <div ref={letter} className="flex min-w-0 flex-1 flex-col overflow-hidden text-[10px] leading-[1.5]">
          {/* Only the name and the grade: the slip travels home in a child's
              bag, so nothing about the measurement is printed. The finding is
              discussed at the meeting. One section per year level at
              Detailen, so the grade is the whole answer. */}
          <p>
            Mahal na magulang o tagapag-alaga ni{' '}
            <strong className="text-[11px]" style={{ color: NAVY }}>
              {name}
            </strong>{' '}
            ({learner.section}),
          </p>
          <p className="mt-1 whitespace-pre-line text-[#1f2937]">
            <Runs text={t.message} />
          </p>
          <p className="mt-1 text-[9.5px] whitespace-pre-line text-[#4b5563] italic">
            <Runs text={t.messageEn} />
          </p>

          <div className="mt-auto pt-1">
            <div className="text-[9.5px]" style={{ fontFamily: SERIF }}>
              {t.closing}
            </div>
            <div className="mt-[0.2in] w-[2in] border-t border-[#374151] pt-[1px] text-[8.5px] text-[#4b5563]">
              {t.signer}
            </div>
          </div>
        </div>

        {/* The meeting, in a ruled table: the one part a parent must not
            misread, so it is set apart and in bold. */}
        <table className="w-[2.5in] shrink-0 self-start border-collapse text-[9.5px]">
          <thead>
            <tr>
              <th
                colSpan={2}
                className="border border-[#9ca3af] px-2 py-[3px] text-left text-[9px] font-bold tracking-[0.06em]"
                style={{ color: NAVY, fontFamily: SERIF }}
              >
                DETALYE NG PULONG <span className="font-normal tracking-normal text-[#4b5563] italic">/ Meeting</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ['Petsa', 'Date', meeting?.date ? meetingDateText(meeting.date) : null],
                ['Oras', 'Time', meeting?.time || null],
                ['Lugar', 'Venue', meeting?.venue || null],
              ] as const
            ).map(([fil, eng, value]) => (
              <tr key={fil} className="align-top">
                <td className="w-[0.72in] border border-[#9ca3af] bg-[#f3f4f6] px-2 py-[4px] leading-tight text-[#374151]">
                  {fil}
                  <div className="text-[8px] text-[#6b7280] italic">{eng}</div>
                </td>
                <td className="border border-[#9ca3af] px-2 py-[4px] leading-snug font-bold break-words" style={{ color: NAVY }}>
                  {value ?? <span className="font-normal text-[#8a5d0d] italic">Hindi pa nakatakda</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* --- Cut line -------------------------------------------------------
          The scissors are an inline SVG, not a font glyph, so they print on
          a driver that has no symbol font. */}
      <div className="mt-[0.1in] mb-[0.08in] flex items-center gap-2 text-[#6b7280]">
        <Scissors size={12} weight="bold" className="shrink-0 -rotate-90" />
        <span className="h-0 flex-1 border-t border-dashed border-[#9ca3af]" />
        <span className="shrink-0 text-[7.5px] tracking-[0.16em] uppercase">Gupitin dito · Cut here</span>
        <span className="h-0 flex-1 border-t border-dashed border-[#9ca3af]" />
      </div>

      {/* --- Attendance stub ----------------------------------------------
          Who and when on the left, the two signatures, and the Stub ID on
          the right, printed large: the nurse types it on the attendance
          screen. (A QR placeholder stood here until 2026-10-14.) */}
      <div className="flex items-end gap-[0.2in]">
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-bold" style={{ color: NAVY, fontFamily: SERIF }}>
            Katibayan ng Pagdalo{' '}
            <span className="text-[8.5px] font-normal text-[#4b5563] italic">/ Attendance Stub</span>
          </div>
          <div className="mt-[2px] truncate text-[10px] font-semibold text-[#111827]">
            {name} <span className="font-normal text-[#4b5563]">· {learner.section}</span>
            {meeting && (
              <span className="font-normal text-[#4b5563]"> · Pulong: {meetingDateText(meeting.date)}</span>
            )}
          </div>
          <div className="mt-[1px] text-[8px] text-[#6b7280]">
            Iabot sa school nurse pagdating · Hand to the school nurse on arrival.
          </div>
          <div className="mt-[0.17in] flex gap-[0.2in]">
            <SignLine fil="Lagda ng magulang" eng="Parent's signature" grow />
            {/* Filled by the nurse at the door, not by the parent at home: it
                is the date they arrived, and it is what the entry writes. */}
            <SignLine fil="Petsa ng pagdalo" eng="Date attended" />
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-center">
          <div className="rounded-[4px] border border-[#9ca3af] px-[0.1in] py-[0.05in] text-center">
            <div className="text-[6.5px] tracking-[0.12em] text-[#6b7280] uppercase">Stub ID</div>
            <div className="font-mono text-[15px] leading-tight font-bold tracking-[0.04em]" style={{ color: NAVY }}>
              {learner.stubId}
            </div>
          </div>
          <div className="mt-[2px] text-[6.5px] text-[#6b7280]">Walang health data · No health data</div>
        </div>
      </div>
    </div>
  )
}

function SignLine({ fil, eng, grow }: { fil: string; eng: string; grow?: boolean }) {
  return (
    <div
      className={`border-t border-[#374151] pt-[1px] text-[7.5px] leading-tight text-[#4b5563] ${grow ? 'flex-1' : 'w-[1.3in]'}`}
    >
      {fil} <span className="italic">/ {eng}</span>
    </div>
  )
}

/* Plain text, with **bold** for the words the letter wants a parent not to
   miss. */
function Runs({ text }: { text: string }) {
  return (
    <>
      {boldRuns(text).map((r, i) => (typeof r === 'string' ? r : <strong key={i}>{r.bold}</strong>))}
    </>
  )
}
