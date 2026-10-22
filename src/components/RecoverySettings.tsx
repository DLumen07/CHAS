import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Key, Printer, ShieldCheck, Warning } from '@phosphor-icons/react'
import { cx } from '@/components/ui'
import { Modal, ModalContent, ModalDescription, ModalTitle } from '@/components/primitives'
import { ApiError, endpoints, type ApiUser } from '@/lib/api'
import { useQuery } from '@/lib/query'
import { schoolIdentity } from '@/lib/school-year'
import { printPaper } from '@/lib/print'

/* Recovery codes: each account's own way back in when a password is
   forgotten, head and nurse alike. They work without internet.

   ONE DIALOG, TWO DOORS. My account opens it to make a new set; the shell
   opens it by itself after sign-in for an account that has none yet
   (RecoverySetupPrompt). Either way the flow is the same:

     intro    what recovery codes are, and one action
     codes    the eight codes, Print, and a tick box - "I have printed or
              written down these codes" - that has to be ticked before Done.
              The codes are shown once and only hashes are kept, so closing
              this step by accident would lose them; Escape and outside
              clicks are ignored here.

   A new set replaces the old one. */

export type RecoveryStatus = { total: number; remaining: number; createdAt: string | null }

export function useRecoveryCodes() {
  return useQuery<RecoveryStatus>('recovery-codes', endpoints.recoveryCodes)
}

const BTN =
  'inline-flex h-10 items-center justify-center gap-2 rounded-[10px] px-4 text-[12.5px] font-semibold transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-40'
const BTN_PRIMARY = cx(BTN, 'bg-navy-900 text-white enabled:hover:bg-navy-800')
const BTN_QUIET = cx(BTN, 'font-medium text-muted hover:bg-wash hover:text-navy-900')
const BTN_SECONDARY = cx(BTN, 'bg-wash text-navy-900 enabled:hover:bg-navy-50')

export function RecoveryCodesDialog({
  open,
  onOpenChange,
  mode,
  owner,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 'setup' for an account with no codes; 'replace' when a set exists. */
  mode: 'setup' | 'replace'
  /** Printed on the sheet: whose codes these are. */
  owner: string
}) {
  const [codes, setCodes] = useState<string[] | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /* Focus starts on the main action, not on "Remind me later". */
  const primary = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    setCodes(null)
    setSaved(false)
    setError(null)
  }, [open])

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const r = await endpoints.createRecoveryCodes()
      setCodes(r.codes)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The codes could not be created. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const showing = codes !== null
  /* While the codes are on screen, only Done closes the dialog. */
  const guard = (e: Event) => {
    if (showing) e.preventDefault()
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (showing && !o) return
        onOpenChange(o)
      }}
    >
      <ModalContent
        className="max-w-[480px]"
        onEscapeKeyDown={guard}
        onInteractOutside={guard}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          primary.current?.focus()
        }}
      >
        <div className="px-7 pt-7 pb-6">
          <span className="grid size-12 place-items-center rounded-full bg-navy-50 text-navy-700">
            {showing ? <ShieldCheck size={24} weight="fill" /> : <Key size={24} weight="fill" />}
          </span>

          {!showing ? (
            <>
              <ModalTitle className="mt-4 font-display text-[20px] leading-tight font-bold tracking-[-0.02em] text-navy-900">
                {mode === 'setup' ? 'Set up account recovery' : 'Create new recovery codes?'}
              </ModalTitle>
              <ModalDescription className="mt-2 text-[13px] leading-relaxed text-muted">
                {mode === 'setup'
                  ? 'Recovery codes let you reset your password if you forget it. You will receive eight codes. Print them or write them down, and keep them in a safe place.'
                  : 'Your current recovery codes will stop working. You will receive eight new codes to print or write down.'}
              </ModalDescription>

              {mode === 'setup' && (
                <ul className="mt-4 space-y-2 text-[12.5px] text-navy-900">
                  {[
                    'Each code can be used once.',
                    'Codes work without an internet connection.',
                    'You can create a new set at any time from My account.',
                  ].map((t) => (
                    <li key={t} className="flex items-start gap-2">
                      <Check size={14} weight="bold" className="mt-0.5 shrink-0 text-navy-700" />
                      {t}
                    </li>
                  ))}
                </ul>
              )}

              {error && <ErrorLine text={error} />}

              <div className="mt-6 flex justify-end gap-2">
                <button type="button" className={BTN_QUIET} onClick={() => onOpenChange(false)}>
                  {mode === 'setup' ? 'Remind me later' : 'Cancel'}
                </button>
                <button ref={primary} type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void create()}>
                  {busy ? 'Creating…' : mode === 'setup' ? 'Create recovery codes' : 'Create new codes'}
                </button>
              </div>
            </>
          ) : (
            <>
              <ModalTitle className="mt-4 font-display text-[20px] leading-tight font-bold tracking-[-0.02em] text-navy-900">
                Your recovery codes
              </ModalTitle>
              <ModalDescription className="mt-2 text-[13px] leading-relaxed text-muted">
                Print these codes or write them down now. They will not be shown again.
              </ModalDescription>

              <ol className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 rounded-[14px] bg-wash px-5 py-4">
                {codes.map((c, i) => (
                  <li key={c} className="flex items-baseline gap-2 font-mono text-[14px] font-semibold text-navy-900">
                    <span className="w-4 text-right text-[11px] font-normal text-muted">{i + 1}.</span>
                    {c}
                  </li>
                ))}
              </ol>

              <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-[12.5px] text-navy-900">
                <input
                  type="checkbox"
                  checked={saved}
                  onChange={(e) => setSaved(e.target.checked)}
                  className="size-4 accent-[var(--color-navy-800)]"
                />
                I have printed or written down these codes.
              </label>

              <div className="mt-6 flex justify-between gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => void printPaper('Recovery codes')}>
                  <Printer size={15} weight="bold" />
                  Print
                </button>
                <button type="button" className={BTN_PRIMARY} disabled={!saved} onClick={() => onOpenChange(false)}>
                  Done
                </button>
              </div>

              <CodesSheet codes={codes} owner={owner} />
            </>
          )}
        </div>
      </ModalContent>
    </Modal>
  )
}

function ErrorLine({ text }: { text: string }) {
  return (
    <p
      role="alert"
      className="mt-4 flex items-start gap-2 rounded-[10px] bg-[#fdf2f5] px-3 py-2.5 text-[12px] leading-relaxed font-medium text-[#9f1239]"
    >
      <Warning size={15} weight="fill" className="mt-px shrink-0" />
      {text}
    </p>
  )
}

/* After sign-in: an account with no recovery codes is asked, in the middle
   of the screen, to make them. "Remind me later" holds for the rest of this
   sign-in (sessionStorage, per account) and it asks again next time. */
const LATER_KEY = 'chas.recovery-later'

export function RecoverySetupPrompt({ user }: { user: ApiUser | undefined }) {
  const status = useRecoveryCodes().data
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!user || !status || status.total > 0) return
    let later: string | null = null
    try {
      later = sessionStorage.getItem(LATER_KEY)
    } catch {
      /* Storage blocked: ask every time, which is the safe side. */
    }
    if (later !== user.id) setOpen(true)
  }, [user, status])

  if (!user) return null
  return (
    <RecoveryCodesDialog
      open={open}
      mode="setup"
      owner={`${user.fullName} (${user.username})`}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) {
          try {
            sessionStorage.setItem(LATER_KEY, user.id)
          } catch {
            /* nothing to remember it in */
          }
        }
      }}
    />
  )
}

/* What prints: the codes alone on a plain sheet, into #print-root like every
   other printout. */
function CodesSheet({ codes, owner }: { codes: string[]; owner: string }) {
  const host = document.getElementById('print-root')
  if (!host) return null
  return createPortal(
    <div style={{ padding: '0.5in', fontFamily: 'Arial, sans-serif', color: '#000' }}>
      <div style={{ fontSize: '16pt', fontWeight: 700 }}>CHAS recovery codes</div>
      <div style={{ fontSize: '10pt', marginTop: '4pt' }}>
        {owner} · {schoolIdentity().name} · {new Date().toLocaleDateString()}
      </div>
      <ol style={{ marginTop: '14pt', columns: 2, fontFamily: 'Consolas, monospace', fontSize: '13pt', lineHeight: 1.8 }}>
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <div style={{ fontSize: '9.5pt', marginTop: '12pt', lineHeight: 1.5 }}>
        Each code can be used once. To use one, select Forgot password? on the sign-in screen. Keep this
        sheet in a safe place.
      </div>
    </div>,
    host,
  )
}
