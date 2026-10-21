/* Toasts: the one way CHAS confirms that something happened.

   A short message in the bottom-right corner after every save, failure or
   print - "Measurement saved for Juan Dela Cruz", with an Undo where undoing
   makes sense. It replaces the mix of banners, chips and silence each screen
   used to have, so the nurse always looks in the same place to know whether
   it worked.

   Success and info messages close themselves after a few seconds; errors stay
   until dismissed, because an error that vanishes before it is read is an
   error nobody fixes. Read out by screen readers (aria-live). */

import { useEffect, useState, useSyncExternalStore } from 'react'
import { CheckCircle, Info, Warning, X } from '@phosphor-icons/react'
import { cx } from './ui'

type Tone = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  tone: Tone
  message: string
  action?: { label: string; onClick: () => void }
}

let items: ToastItem[] = []
let nextId = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function push(tone: Tone, message: string, action?: ToastItem['action']): number {
  const id = nextId++
  /* At most three at once: a burst of saves should not wall off the screen. */
  items = [...items, { id, tone, message, action }].slice(-3)
  emit()
  return id
}

export function dismissToast(id: number) {
  items = items.filter((t) => t.id !== id)
  emit()
}

export const toast = {
  success: (message: string, action?: ToastItem['action']) => push('success', message, action),
  error: (message: string) => push('error', message),
  info: (message: string, action?: ToastItem['action']) => push('info', message, action),
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => items, () => items)
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed right-5 bottom-5 z-[100] flex w-[360px] max-w-[calc(100vw-40px)] flex-col gap-2"
    >
      {list.map((t) => (
        <ToastCard key={t.id} t={t} />
      ))}
    </div>
  )
}

const ICON: Record<Tone, typeof CheckCircle> = { success: CheckCircle, error: Warning, info: Info }

function ToastCard({ t }: { t: ToastItem }) {
  const [hover, setHover] = useState(false)

  useEffect(() => {
    if (t.tone === 'error' || hover) return
    const timer = setTimeout(() => dismissToast(t.id), t.action ? 7000 : 4500)
    return () => clearTimeout(timer)
  }, [t, hover])

  const Icon = ICON[t.tone]
  return (
    <div
      role={t.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={cx(
        'pointer-events-auto flex items-start gap-3 rounded-[14px] bg-white px-4 py-3',
        'shadow-[0_10px_30px_-8px_rgba(14,36,100,0.35),0_0_0_1px_rgba(14,36,100,0.06)]',
        'animate-[toast-in_180ms_ease-out]',
      )}
    >
      <Icon
        size={18}
        weight="fill"
        className={cx(
          'mt-px shrink-0',
          t.tone === 'success' && 'text-[var(--color-n)]',
          t.tone === 'error' && 'text-[#9f1239]',
          t.tone === 'info' && 'text-navy-700',
        )}
      />
      <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-navy-900">{t.message}</p>
      {t.action && (
        <button
          type="button"
          onClick={() => {
            t.action!.onClick()
            dismissToast(t.id)
          }}
          className="shrink-0 rounded-full px-2 py-0.5 text-[12px] font-semibold text-navy-700 transition-colors duration-100 hover:bg-navy-50"
        >
          {t.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => dismissToast(t.id)}
        aria-label="Dismiss"
        className="grid size-5 shrink-0 place-items-center rounded-full text-placeholder transition-colors duration-100 hover:bg-wash hover:text-navy-900"
      >
        <X size={11} weight="bold" />
      </button>
    </div>
  )
}
