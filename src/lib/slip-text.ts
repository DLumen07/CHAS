/* The invitation slip's fixed wording (2026-10-19: the user asked to edit
   it). The head or the nurse changes it on the Slips screen; the school's
   row stores it (schools.slipText), so both roles print the same letter.
   What a person types is plain text: line breaks are kept, and text between
   ** and ** prints in bold, as the default does for the line about the stub.

   Not here, and not editable: the learner's name, class and Stub ID, and
   the meeting's date, time and venue. Those are filled in on each slip. */

export interface SlipText {
  /** "PAANYAYA SA MAGULANG" */
  title: string
  /** The English line under the title. */
  subtitle: string
  /** The letter, in Filipino. */
  message: string
  /** The letter, in English, printed under it in italics. */
  messageEn: string
  /** "Lubos na gumagalang," */
  closing: string
  /** The line under the signature. */
  signer: string
}

/** What every slip printed before the wording could be edited. */
export const DEFAULT_SLIP_TEXT: SlipText = {
  title: 'PAANYAYA SA MAGULANG',
  subtitle: 'Parent / Guardian Invitation',
  message:
    'Kayo po ay magalang na inaanyayahang dumalo sa isang pulong sa paaralan upang pag-usapan ang kalusugan ng inyong anak at ang tulong na maibibigay ng paaralan. Ang resulta ng pagsukat ay ipapaliwanag po sa pulong. **Pakidala po ang bahaging pinutol sa ibaba** at iabot sa school nurse pagdating.',
  messageEn:
    'You are respectfully invited to a meeting at the school to discuss your child’s health and the support the school can provide. Please bring the portion below and hand it to the school nurse on arrival.',
  closing: 'Lubos na gumagalang,',
  signer: 'School Nurse',
}

/** The same limits the server checks (routes/school.ts). */
export const SLIP_TEXT_MAX: Record<keyof SlipText, number> = {
  title: 40,
  subtitle: 60,
  message: 520,
  messageEn: 420,
  closing: 40,
  signer: 40,
}

/** The stored wording over the defaults. A key missing from what the
    server sent - an older row, a hand edit - prints its default rather than
    a blank. */
export function slipTextOf(stored: Partial<SlipText> | null | undefined): SlipText {
  const out = { ...DEFAULT_SLIP_TEXT }
  if (!stored) return out
  for (const k of Object.keys(out) as (keyof SlipText)[]) {
    const v = stored[k]
    if (typeof v === 'string' && v.trim()) out[k] = v
  }
  return out
}

export function isDefaultSlipText(t: SlipText): boolean {
  return (Object.keys(DEFAULT_SLIP_TEXT) as (keyof SlipText)[]).every((k) => t[k] === DEFAULT_SLIP_TEXT[k])
}

/** "a **b** c" -> ['a ', {bold: 'b'}, ' c'], for the sheet to render. */
export function boldRuns(text: string): (string | { bold: string })[] {
  return text.split(/\*\*(.+?)\*\*/s).map((part, i) => (i % 2 === 1 ? { bold: part } : part))
}
