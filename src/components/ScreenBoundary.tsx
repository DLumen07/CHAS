import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ArrowClockwise, WarningCircle } from '@phosphor-icons/react'

/* The last thing between a broken screen and a white rectangle.
 *
 * WHY THIS EXISTS, and it is not a hypothetical. Every screen in this app is
 * lazily imported, so opening one fetches a chunk over the wire. When that
 * fetch fails - a half-written build, a stale index.html pointing at a file
 * the last deploy replaced, a laptop that lost the school's wifi mid-click -
 * React.lazy throws during render. Suspense does not catch a throw; it only
 * waits for a promise. With nothing above it, React unmounts the whole tree
 * and the user is left looking at a blank page with no message, no error and
 * nothing to press.
 *
 * That is the worst failure this app can have, because it is indistinguishable
 * from the software being broken in some deep way, and a nurse in front of a
 * blank screen has no way to tell that reloading would fix it. So: a boundary
 * that says what happened and offers the one action that usually works.
 *
 * A CLASS COMPONENT, deliberately. React has no hook for this - error
 * boundaries are the one thing that still requires componentDidCatch - and a
 * third-party package for twelve lines would be a dependency to justify
 * later.
 *
 * IT DOES NOT SWALLOW THE ERROR. The original is logged, so the console still
 * carries the stack a developer needs. What changes is only what the person
 * in front of the machine sees.
 */

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export default class ScreenBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    /* Kept, not replaced. The boundary is for the person; the console is for
       whoever has to fix it. */
    console.error('[chas] screen failed to render', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    /* A failed dynamic import reads quite differently from a bug in a screen,
       and the two want different advice: the first is almost always fixed by
       reloading, the second is not. The message says which one this looks
       like rather than giving one sentence that is half wrong either way. */
    const chunkFailed =
      /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(
        error.message,
      )

    return (
      <div className="grid h-full place-items-center px-6 pb-6">
        <div className="flex max-w-[46ch] flex-col items-center gap-3 text-center">
          <WarningCircle size={24} weight="light" className="text-[#b6c1d2]" />
          <div className="text-[13px] font-medium text-navy-900">
            {chunkFailed ? 'This screen could not be loaded' : 'An error occurred on this screen'}
          </div>
          <p className="text-[12px] leading-relaxed text-muted">
            {chunkFailed
              ? 'This screen could not be opened. Close CHAS and open it again.'
              : 'Saved records are not affected. Close CHAS and open it again to continue.'}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-1 inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-navy-900 px-3.5 text-[12.5px] font-semibold text-white transition-colors duration-100 hover:bg-navy-800"
          >
            <ArrowClockwise size={14} weight="bold" />
            Reload CHAS
          </button>
          {/* The message itself, quietly. Somebody reading it down a telephone
              to whoever supports the school is worth more than a tidy box. */}
          <code className="mt-1 max-w-full truncate text-[10.5px] text-placeholder">
            {error.message}
          </code>
        </div>
      </div>
    )
  }
}
