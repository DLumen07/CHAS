/* One shared cache for the API's read requests.

   Several parts of a screen ask for the same thing: the weigh-in
   station's growth panel and the learner record both read one learner's
   record, and the growth chart re-read every measurement each time the roster
   object changed. Each asked on its own, so one page load made the same
   request two, three or five times.

   Here a key ("learner:<id>") is fetched once and shared by every
   component that asks for it while the data is current. Any write - every
   POST, PUT, PATCH and DELETE through lib/api.ts - calls invalidate(), which
   drops the cache and tells the mounted components to read again, so nothing
   shows figures from before a save. Signing out clears it too.

   Deliberately small: no timers, no retries, no background refresh. The data
   lives on this computer and only changes when somebody saves. */

import { useEffect, useState, useSyncExternalStore } from 'react'

let version = 0
const listeners = new Set<() => void>()
const cache = new Map<string, Promise<unknown>>()
const settled = new Map<string, unknown>()

/** Forget everything cached. Called after every write and on sign-out. */
export function invalidate() {
  version++
  cache.clear()
  settled.clear()
  for (const l of listeners) l()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** The shared promise for `key`, started on first use. */
export function cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  let p = cache.get(key) as Promise<T> | undefined
  if (!p) {
    p = fetcher().then(
      (value) => {
        settled.set(key, value)
        return value
      },
      (err) => {
        /* A failure is not cached: the next caller tries again. */
        cache.delete(key)
        throw err
      },
    )
    cache.set(key, p)
  }
  return p
}

export interface Query<T> {
  data: T | undefined
  error: unknown
  loading: boolean
}

/** Read `key` through the shared cache. A null key reads nothing. */
export function useQuery<T>(key: string | null, fetcher: () => Promise<T>): Query<T> {
  const v = useSyncExternalStore(subscribe, () => version, () => version)
  const [state, setState] = useState<Query<T>>(() => ({
    data: key ? (settled.get(key) as T | undefined) : undefined,
    error: null,
    loading: Boolean(key) && !settled.has(key ?? ''),
  }))

  useEffect(() => {
    if (!key) return
    let live = true
    const ready = settled.has(key)
    if (ready) setState({ data: settled.get(key) as T, error: null, loading: false })
    else setState((s) => ({ ...s, loading: true, error: null }))
    cached(key, fetcher).then(
      (data) => live && setState({ data, error: null, loading: false }),
      (error) => live && setState((s) => ({ ...s, error, loading: false })),
    )
    return () => {
      live = false
    }
    // The fetcher is a fresh closure each render; the key names what it fetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, v])

  return state
}
