import { useEffect, useRef, useState } from 'react'
import { FilePdf, X } from '@phosphor-icons/react'
import { Button } from './ui'
import { ModalContent, ModalDescription, ModalTitle } from './primitives'
import { SF8_PAGE, Sf8Measure, Sf8PageView, paginate, type Sf8Layout } from './Sf8Form'
import type { Sf8Form } from '../lib/sf8'
import type { Sf8FormAssets } from '../../electron/sf8-core.mjs'

/* The SF8 before it is saved.

   Each page is drawn as a sheet of long bond paper, landscape, from the same
   pages the PDF is printed from (see `paginate` in Sf8Form.tsx), so the
   preview is the file rather than an impression of it. Save PDF hands that
   layout to the export as it is. */

/** Long bond landscape, the whole sheet, in CSS pixels. */
const SHEET = { width: 13 * 96, height: 8.5 * 96 }
const MARGIN = 0.25 * 96

export function Sf8Preview({
  form,
  assets,
  grade,
  busy,
  onSave,
  onClose,
}: {
  form: Sf8Form
  assets: Sf8FormAssets
  grade: string
  busy: boolean
  onSave: (layout: Sf8Layout) => void
  onClose: () => void
}) {
  const [layout, setLayout] = useState<Sf8Layout | null>(null)

  /* The sheets are drawn at full size and scaled to the window's width. */
  const area = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.6)
  useEffect(() => {
    const el = area.current
    if (!el) return
    const fit = () => setScale(Math.min(1, (el.clientWidth - 48) / SHEET.width))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pages = layout?.pages.length ?? 0

  return (
    <ModalContent className="h-[min(94vh,900px)] max-w-[1180px]">
      <header className="flex shrink-0 items-start gap-4 px-7 pt-6 pb-4">
        <div className="min-w-0 flex-1">
          <ModalTitle className="font-display text-[19px] leading-tight font-bold tracking-[-0.02em] text-navy-900">
            SF8 preview &middot; {grade}
          </ModalTitle>
          <ModalDescription className="mt-1 text-[12.5px] text-muted">
            {layout
              ? `${pages} ${pages === 1 ? 'page' : 'pages'} · Long bond, landscape${
                  layout.zoom < 1 ? ` · fitted to one page (${Math.round(layout.zoom * 100)}%)` : ''
                }`
              : 'Preparing the pages…'}
          </ModalDescription>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label="Close"
          className="grid size-9 shrink-0 place-items-center rounded-[10px] text-muted transition-colors duration-100 hover:bg-wash hover:text-navy-900"
        >
          <X size={16} weight="bold" />
        </button>
      </header>

      <div ref={area} className="min-h-0 flex-1 overflow-auto bg-wash px-6 py-6">
        {!layout && (
          <Sf8Measure form={form} assets={assets} onMeasured={(m) => setLayout(paginate(form, m))} />
        )}
        {layout && (
          <div className="flex flex-col items-center gap-6">
            {layout.pages.map((page, i) => (
              <div key={i} className="flex flex-col items-center gap-2">
                <div
                  className="relative overflow-hidden bg-white shadow-[0_8px_24px_-12px_rgba(4,12,36,0.35)]"
                  style={{ width: SHEET.width * scale, height: SHEET.height * scale }}
                >
                  <div
                    className="absolute top-0 left-0 origin-top-left"
                    style={{
                      width: SHEET.width,
                      height: SHEET.height,
                      padding: MARGIN,
                      transform: `scale(${scale})`,
                    }}
                  >
                    <div style={{ width: SF8_PAGE.width, height: SF8_PAGE.height, overflow: 'hidden' }}>
                      <div className="sf8-form" style={{ zoom: layout.zoom }}>
                        <Sf8PageView form={form} assets={assets} page={page} />
                      </div>
                    </div>
                  </div>
                </div>
                <span className="text-[11px] text-muted">
                  Page {i + 1} of {pages}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className="flex shrink-0 items-center gap-2.5 border-t border-line-soft bg-canvas px-7 py-4">
        <Button variant="ghost" className="h-10 px-4 text-[13px]" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <span className="flex-1" />
        <Button
          variant="primary"
          className="h-10 rounded-[10px] px-5 text-[13px] font-semibold"
          icon={<FilePdf size={15} weight="bold" />}
          onClick={() => layout && onSave(layout)}
          disabled={!layout || busy}
        >
          {busy ? 'Saving…' : 'Save PDF'}
        </Button>
      </footer>
    </ModalContent>
  )
}
