/* Getting a slip out of the app: onto paper, or into a PDF file.

   Both routes render the SAME markup under the same print stylesheet. The
   screens put the sheets they want issued into `#print-root` (see
   `index.html`), then call one of these:

     - `printPaper()` opens the system print dialog. The user can of course
       pick "Microsoft Print to PDF" there too; the dedicated route below
       exists because on a school workstation that driver is not always
       installed, and because a save dialog is one step instead of four.

     - `savePdf()` asks the main process for a real PDF through
       `chas:print:pdf`. Chromium lays out the page with the print stylesheet
       and the @page size, so the file is the printout - vector text, true
       8.5in x 5.5in pages, one slip per page.

   In a plain browser (`npm run dev:renderer`) there is no bridge, so
   `savePdf` reports `unavailable` and the caller falls back to the dialog.
*/

export type PdfResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'canceled' }
  | { ok: false; reason: 'unavailable' }
  | { ok: false; reason: 'error'; message: string }

interface PrintBridge {
  pdf: (opts: { suggestedName: string; title?: string }) => Promise<PdfResult>
}

const bridge = (): PrintBridge | undefined =>
  (window as unknown as { chas?: { print?: PrintBridge } }).chas?.print

/** True when this build can write a PDF itself, rather than going through the
    print dialog. Electron only. */
export function canSavePdf(): boolean {
  return Boolean(bridge())
}

/** `title` heads the save dialog; the slips' own wording when omitted. */
export async function savePdf(suggestedName: string, title?: string): Promise<PdfResult> {
  const b = bridge()
  if (!b) return { ok: false, reason: 'unavailable' }
  try {
    return await b.pdf({ suggestedName, title })
  } catch (err) {
    return { ok: false, reason: 'error', message: String(err) }
  }
}

export function printPaper(): void {
  window.print()
}

/** `CHAS-slips-2026-08-10.pdf`, or the stub ID when it is a single learner. */
export function pdfFileName(count: number, stubId: string | null, on: string): string {
  return count === 1 && stubId ? `CHAS-slip-${stubId}.pdf` : `CHAS-slips-${on}.pdf`
}
