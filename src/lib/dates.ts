/* One way to write a date on screen: "Aug 10, 2026".

   Records keep ISO dates (2026-08-10) because they sort and compare, and the
   exports keep them because DepEd's forms do. People read the screen, and a
   school nurse does not read ISO. Every on-screen date goes through here so
   the app never shows the same day three different ways.

   The locale is fixed rather than taken from the machine: a school laptop set
   to another region would otherwise swap day and month on one screen and not
   on the next. */

const DAY = /^\d{4}-\d{2}-\d{2}/

function asLocalDay(iso: string): Date | null {
  if (!DAY.test(iso)) return null
  const d = new Date(`${iso.slice(0, 10)}T00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** "Aug 10, 2026". Anything that is not an ISO date is returned as it came. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = asLocalDay(iso)
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : iso
}

/** "Aug 10, 2026, 3:30 PM", for a moment rather than a day. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** "Sep 1 – Nov 30, 2026", or with both years when they differ. */
export function formatRange(from: string, to: string): string {
  const a = asLocalDay(from)
  const b = asLocalDay(to)
  if (!a || !b) return `${formatDate(from)} – ${formatDate(to)}`
  if (a.getFullYear() !== b.getFullYear()) return `${formatDate(from)} – ${formatDate(to)}`
  const start = a.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${start} – ${formatDate(to)}`
}

/** Today as an ISO day, in local time. */
export function todayIso(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
