import { Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import {
  NavLink,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom'
import {
  Users,
  Ruler,
  Printer,
  Ticket,
  SignOut,
  UserCircle,
  Key,
  MagnifyingGlass,
  X,
  Buildings,
  FileXls,
  IdentificationBadge,
  Database,
  FirstAidKit,
  CaretLeft,
  CaretRight,
  GraduationCap,
  GearSix,
} from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import { cx } from './ui'
import { HeaderSlot } from './headerSlot'
import { AppLogo } from './AppLogo'
import { useRoster, isAdmin, isNurse, SERVER_BACKED, type Install } from '../lib/records'
import { useSchoolYear } from '../lib/school-year'
import { endpoints } from '../lib/api'
import { useQuery } from '../lib/query'
import { RecoverySetupPrompt } from './RecoverySettings'
import { resetStore } from '../lib/server-records'
import ScreenBoundary from './ScreenBoundary'
import { Toaster } from './toast'
import { ConfirmDialog } from './primitives'

interface Item {
  to: string
  label: string
  icon: Icon
  badge?: number
}

/* The audit log and settings are held back for the first presentation. Their
   screens are still in src/screens and their routes are commented out in
   App.tsx; restore both together.

   'Advise' covers the whole second half of the process now: print the
   invitations, then log the parents who answer them. The two screens are one
   group because they are one errand - the second is what the first is for. */
interface Group {
  heading: string
  items: Item[]
}

const ROSTER: Item = { to: '/learners', label: 'Learners', icon: Users }
const WEIGH_IN: Item = { to: '/weigh-in', label: 'Weigh-in', icon: Ruler }
/* Who has been measured, and every measurement saved, corrected or removed. */

/* Both installs weigh school-wide; the overview is each one's home. */
const MEASURE: Group = {
  heading: 'Measure',
  items: [ROSTER, WEIGH_IN],
}

/* 'Advise' covers the second half of the process: invite the parents of the
   children the weigh-in flagged, then log who came. */
const ADVISE: Group = {
  heading: 'Advise',
  items: [
    { to: '/slips', label: 'Invitation slips', icon: Printer },
    { to: '/attendance', label: 'Meeting attendance', icon: Ticket },
  ],
}

/* The head's second group: the school-wide errands that are not the weigh-in.

   These are separated from 'School' above rather than piled into it because
   they answer a different question. 'School' is what the roster says; this is
   what the head has to DO about it - the SF8 that leaves the school, the
   staff accounts, and the copy of the records
   that survives the laptop. Grouping the overview with the report would put a
   reading screen and three writing screens under one heading. */
const REPORT: Group = {
  heading: 'Report and manage',
  items: [
    { to: '/sf8', label: 'SF8 export', icon: FileXls },
    { to: '/roles', label: 'Roles', icon: IdentificationBadge },
    { to: '/backup', label: 'Backup and restore', icon: Database },
    /* Closing the year and promoting every learner. Server builds only:
       the local store has one laptop's file and no enrolment history. */
    ...(SERVER_BACKED ? [{ to: '/school-year', label: 'New school year', icon: GraduationCap }] : []),
    /* The school's own details and logo (2026-10-15), so the app can be set
       up for any school. */
    ...(SERVER_BACKED ? [{ to: '/school-settings', label: 'School settings', icon: GearSix }] : []),
  ],
}

/* The nurse's share of the reporting: the SF8 only. */
const NURSE_REPORT: Group = {
  heading: 'Report',
  items: [{ to: '/sf8', label: 'SF8 export', icon: FileXls }],
}

/* The school head's group, and it sits ABOVE the rest deliberately.

   Nav order is a claim about what the screen is for. A head opens this to
   read the school, so the school-wide view is first - putting it under the
   daily errands would make the one screen that install exists for the
   fourth item down. */
const SCHOOL_GROUP: Group = {
  heading: 'School',
  items: [{ to: '/admin', label: 'School overview', icon: Buildings }],
}

/* The nurse's version of the same item, and it is the same screen.

   The overview is a table of sections with a nutrition figure against each,
   which is the school's own summary AND the clinical one - the wasted column
   is the list of children she will see. Building a second screen to show the
   same query under a different heading would be two screens to keep in
   agreement about one set of numbers.

   What changes is the word. She does not open this to read "the school"; she
   opens it to find out where the flagged children are, so the item says so
   and the group above it is hers. */
const HEALTH_GROUP: Group = {
  heading: 'Health',
  items: [{ to: '/admin', label: 'Health overview', icon: FirstAidKit }],
}

/* Every route's own name, whether or not this install has it in the sidebar.

   The header used to read its title off the visible nav, which is right until
   a screen is reachable without being listed - a nurse who opens /sf8 by
   URL got a page headed "CHAS". A route that exists has a name; whether the
   sidebar offers it is a separate question. */
const TITLES: Record<string, string> = {
  ...Object.fromEntries(
    [SCHOOL_GROUP, MEASURE, ADVISE, REPORT].flatMap((g) => g.items.map((i) => [i.to, i.label])),
  ),
}

/* The nurse's names for the routes she shares with the head. Only /admin
   differs, and it differs because the two accounts open it for different
   reasons - see HEALTH_GROUP. Kept as an override rather than as a second
   full table so a route added to TITLES is named on her install too. */
const NURSE_TITLES: Record<string, string> = { '/admin': 'Health overview' }
TITLES['/account'] = 'My account'

/* One line under each page title saying what the page is for and what to do
   on it. Standard practice, and the quickest way for a new user to find
   their feet on a screen they have not used before. */
const HINTS: Record<string, string> = {
  '/admin': 'The school’s nutritional status at a glance.',
  '/learners': 'Every registered learner, as cards or a table. Select a learner to open the record.',
  '/weigh-in': 'Enter height and weight. The nutritional status is calculated as you type.',
  '/slips': 'Check the slip, then print it or save it as a PDF.',
  '/attendance': 'Type the stub ID on each parent’s slip to record attendance.',
  '/sf8': 'Check each grade, then print or export the DepEd SF8 report.',
  '/roles': 'Create staff accounts and reset passwords.',
  '/backup': 'Save a copy of all records to a USB drive, or restore one.',
  '/school-year': 'Close the current school year and promote learners to the next grade level.',
  '/school-settings': 'The school details and logo used on the SF8 and slips, and the year levels and sections.',
  '/account': 'Your account details, password and recovery codes.',
}
const NURSE_HINTS: Record<string, string> = { '/admin': 'Learners who require follow-up.' }

/** The nav this install gets. The head's install keeps Measure and Advise as
    well as her own groups - she does weigh learners and does print slips. */
function groupsFor(install: Install | null): Group[] {
  if (isAdmin(install)) return [SCHOOL_GROUP, MEASURE, ADVISE, REPORT]

  /* The nurse: the head's reach across the roster, none of the head's
     management. She gets the overview, the roster and the weigh-in - she
     weighs any learner in the school - and the slips and the attendance,
     because the invitation a flagged child goes home with is hers to print
     and the parent who answers it is hers to meet.

     She also gets the SF8 export (added 2026-10-08 at the user's request):
     she is the one who measures every learner, so preparing the report from
     those measurements is hers too. The screen builds the file on this
     laptop from the roster she can already read; there is no admin-only
     endpoint behind it.

     The rest of the head's REPORT group stays off her list: the accounts are
     the head's to issue and the backup is hers to hold, and the server
     refuses both to a nurse anyway - assertAdmin, not learnerScope - so
     offering them would be links that end in a red banner. */
  if (isNurse(install)) return [HEALTH_GROUP, MEASURE, ADVISE, NURSE_REPORT]

  /* Unclaimed: the shell redirects to sign-in before this can show. */
  return []
}

/* The install stores a name the way a DepEd form wants it - "Mrs. C. Delos
   Reyes" - and the chrome wants the parts separately: a surname to greet, and
   initials for the avatar.

   The first word is the given name (or its initial), then an optional middle
   initial, and everything after that is the surname, taken whole. Not the
   last word: "Delos Reyes" and "Dela Cruz" are one surname in two words. The
   title and a suffix (Jr., III) are dropped. Accounts made since 2026-10-14
   carry a full first name - "Mrs. Maria C. Delos Reyes" - and older ones an
   initial, "Mrs. C. Delos Reyes"; both split the same way. */
function splitName(name: string): { given: string; surname: string } {
  const words = name
    .trim()
    .replace(/^(Mrs|Mr|Ms|Dr|Gng|Bb|G)\.?\s+/i, '')
    .split(/\s+/)
    .filter((w) => w && !/^(Jr|Sr)\.?$|^(II|III|IV)$/i.test(w))
  const given = (words.shift() ?? '').replace(/\.$/, '')
  if (words.length > 1 && /^[A-Za-z]\.$/.test(words[0])) words.shift()
  return { given, surname: words.join(' ') }
}

function initials(name: string | undefined): string {
  if (!name) return '--'
  const { given, surname } = splitName(name)
  return ((given[0] ?? '') + (surname[0] ?? '')).toUpperCase()
}

/** What the person signed in is, for the chip under their name. */
function roleLabel(install: Install | null): string {
  if (isAdmin(install)) return 'School Head'
  if (isNurse(install)) return 'School Nurse'
  return '-'
}

/** What this install is scoped to. Both roles read every section. */
function scopeLabel(install: Install | null): string {
  return install ? 'All sections' : '-'
}

export default function Shell() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { install, ready } = useRoster()
  const schoolYear = useSchoolYear()
  const [q, setQ] = useState('')
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  /* "/" jumps to the search box from anywhere, as in most web apps, unless
     the person is already typing in a field. */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      e.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* Folded or open, remembered per machine. Storage can be unavailable (a
     locked-down profile), and the sidebar must still work without it. */
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('chas:sidebar') === 'collapsed'
    } catch {
      return false
    }
  })
  function toggleCollapsed() {
    setCollapsed((c) => {
      try {
        localStorage.setItem('chas:sidebar', c ? 'open' : 'collapsed')
      } catch {
        /* Not remembered, still toggled. */
      }
      return !c
    })
  }

  /* This is the app's only learner search. The roster screen used to carry a
     second one in its own toolbar, which meant two fields doing one job, one
     of them 60px above the other. On the roster this field IS the filter and
     the term lives in the URL, so it survives a reload and can be linked to;
     anywhere else it is a jump-to-the-roster box. */
  const onLearners = pathname.startsWith('/learners')
  const urlQ = params.get('q') ?? ''
  useEffect(() => {
    if (onLearners) setQ(urlQ)
  }, [onLearners, urlQ])

  const groups = useMemo(() => groupsFor(install), [install])
  const active = Object.keys(TITLES).find((to) => pathname.startsWith(to))

  /* A screen with a full-height rail takes the header into its own scrolling
     column, so the rail can start at the sidebar's top line and the header
     still scrolls away with the cards. It hands us the node to render into;
     until then, and everywhere else, the header is a band of its own. */
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null)
  const renderHeader = (el: ReactElement) => (headerSlot ? createPortal(el, headerSlot) : el)

  /* The header search is real: it hands the term to the Learners screen,
     which seeds its own filter box from ?q. A search field that only looked
     like one would be worse than no search field. */
  function search(term: string, replace: boolean) {
    /* Merge rather than overwrite: the roster's grade filter is a URL param
       too, and typing a name must not silently drop it. */
    const next = new URLSearchParams(onLearners ? params : undefined)
    if (term.trim()) next.set('q', term.trim())
    else next.delete('q')
    const qs = next.toString()
    navigate({ pathname: '/learners', search: qs ? `?${qs}` : '' }, { replace })
  }

  /* On the roster, filter as the term is typed - waiting for Enter to see a
     list narrow is a keystroke nobody should have to guess at. Anywhere else
     Enter is what leaves the current screen, so typing must not. */
  function onSearchChange(v: string) {
    setQ(v)
    if (onLearners) search(v, true)
  }

  /* End the session, then go to the door.

     The navigation happens whether or not the request succeeded. A nurse who
     has pressed Sign out on a laptop she is walking away from must not be
     left signed in because the server was briefly unreachable - the local
     state is cleared regardless, and the cookie's own expiry is the backstop
     for the session row that could not be deleted. */
  async function signOut() {
    setConfirmSignOut(false)
    if (SERVER_BACKED) {
      try {
        await endpoints.signOut()
      } catch {
        /* Deliberately swallowed - see above. */
      }
      resetStore()
    }
    navigate('/', { replace: true })
  }

  function submitSearch(e: FormEvent) {
    e.preventDefault()
    search(q, false)
  }

  /* An unclaimed laptop has no roster - useRoster deliberately returns nobody
     until a section is chosen - so every screen behind this would render an
     empty shell of itself. Send the user back to sign in and claim it. The
     wait for `ready` matters: the records file is read from disk, and
     redirecting before it lands would bounce a claimed install out on every
     cold start. */
  if (ready && !install) return <Navigate to="/" replace />

  return (
    /* Full-bleed. The sheet used to float on a 12px canvas margin, which reads
       as a dialog rather than as the application window - and on a 1366x768
       school laptop it spent 24px of the only two directions that are short.
       Every scroll still happens inside the sheet. */
    <div className="h-full bg-ground">
      <div className="app-shell flex h-full overflow-hidden">
        {/* --- Sidebar. A rounded royal-blue panel floating on the canvas,
                and it folds down to a rail of icons.

                Folded, every label moves into the item's tooltip and the
                group headings become short rules, so the order of the nav
                still reads. The choice is remembered on this machine: a
                nurse who wants the width for the roster wants it every
                morning, not until the next reload.

                The seal keeps its white plate (royal blue on navy is 1.13:1)
                and the current screen is still marked in the seal's yellow. --- */}
        <div className="shrink-0 py-3 pl-3">
          <aside
            className={cx(
              'relative flex h-full flex-col rounded-[22px]',
              'shadow-[0_18px_40px_-22px_rgba(14,36,100,0.65)]',
              'transition-[width] duration-200 ease-[var(--ease-chas)]',
              collapsed ? 'w-[76px]' : 'w-[228px]',
            )}
            style={{
              background: 'linear-gradient(180deg, #2b52c4 0%, #1b3a92 52%, #0e2464 100%)',
            }}
          >
            {/* The fold control, riding the middle of the panel's right edge. */}
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!collapsed}
              className="absolute top-1/2 -right-3 z-10 grid size-6 -translate-y-1/2 place-items-center rounded-full bg-white text-navy-800 shadow-[0_2px_8px_rgba(14,36,100,0.28)] transition-transform duration-100 hover:scale-110"
            >
              {collapsed ? <CaretRight size={12} weight="bold" /> : <CaretLeft size={12} weight="bold" />}
            </button>

            <div
              className={cx(
                'flex items-center gap-3 pt-5 pb-5',
                collapsed ? 'justify-center px-0' : 'px-5',
              )}
            >
              <AppLogo tile size={46} />
              {!collapsed && (
                <div className="min-w-0">
                  <div className="font-display text-[28px] leading-none font-extrabold tracking-[0.02em] text-white">
                    CHAS
                  </div>
                </div>
              )}
            </div>

            <nav className={cx('min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-2', collapsed ? 'px-3' : 'px-3')}>
              {groups.map((group, gi) => (
                <div key={group.heading} className={collapsed ? 'mb-3' : 'mb-5'}>
                  {collapsed ? (
                    gi > 0 && <div className="mx-auto mb-3 h-px w-8 bg-white/15" />
                  ) : (
                    <div className="px-2.5 pb-1.5 text-[10px] font-semibold tracking-[0.08em] text-white/55 uppercase">
                      {group.heading}
                    </div>
                  )}
                  <ul className={collapsed ? 'space-y-2' : 'space-y-1'}>
                    {group.items.map(({ to, label, icon: Ico, badge }) => (
                      <li key={to}>
                        <NavLink
                          to={to}
                          title={collapsed ? label : undefined}
                          aria-label={collapsed ? label : undefined}
                          className={({ isActive }) =>
                            cx(
                              'group relative flex items-center text-[13px] transition-colors duration-100',
                              collapsed
                                ? 'mx-auto size-11 justify-center rounded-[14px]'
                                : 'gap-3 rounded-[12px] px-2.5 py-2.5',
                              isActive
                                ? 'bg-white/16 font-semibold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]'
                                : 'text-white/75 hover:bg-white/10 hover:text-white',
                            )
                          }
                        >
                          {({ isActive }) => (
                            <>
                              {!collapsed && (
                                <span
                                  className={cx(
                                    'absolute top-1/2 -left-3 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-seal-yellow',
                                    isActive ? 'opacity-100' : 'opacity-0',
                                  )}
                                />
                              )}
                              <Ico
                                size={collapsed ? 20 : 18}
                                weight={isActive ? 'fill' : 'regular'}
                                className={isActive ? 'text-seal-yellow' : 'text-white/65'}
                              />
                              {!collapsed && <span className="flex-1 truncate">{label}</span>}
                              {badge ? (
                                <span
                                  className={cx(
                                    'tnum rounded-full bg-seal-yellow px-1.5 text-[10px] leading-[16px] font-bold text-navy-950',
                                    collapsed && 'absolute -top-1 -right-1',
                                  )}
                                >
                                  {badge}
                                </span>
                              ) : null}
                            </>
                          )}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>

            <div className={cx('border-t border-white/10 py-2.5', collapsed ? 'px-2' : 'px-3')}>
              {/* Both roles: the person's own email and recovery codes. */}
              {SERVER_BACKED && (
                <NavLink
                  to="/account"
                  title={collapsed ? 'My account' : undefined}
                  aria-label="My account"
                  className={({ isActive }) =>
                    cx(
                      'mb-1 flex items-center text-[13px] transition-colors duration-100 hover:bg-white/10 hover:text-white',
                      isActive ? 'bg-white/10 text-white' : 'text-white/75',
                      collapsed
                        ? 'mx-auto size-11 justify-center rounded-[14px]'
                        : 'w-full gap-3 rounded-[12px] px-2.5 py-2 text-left',
                    )
                  }
                >
                  <UserCircle size={18} className="text-white/65" />
                  {!collapsed && 'My account'}
                </NavLink>
              )}
              {/* A button, not a link: against a server, navigating away
                  leaves the session cookie live, so ending it server-side is
                  the point of the control. */}
              <button
                type="button"
                onClick={() => setConfirmSignOut(true)}
                title={collapsed ? 'Sign out' : undefined}
                aria-label="Sign out"
                className={cx(
                  'flex items-center text-[13px] text-white/75 transition-colors duration-100 hover:bg-white/10 hover:text-white',
                  collapsed
                    ? 'mx-auto size-11 justify-center rounded-[14px]'
                    : 'w-full gap-3 rounded-[12px] px-2.5 py-2 text-left',
                )}
              >
                <SignOut size={18} className="text-white/65" />
                {!collapsed && 'Sign out'}
              </button>
            </div>
          </aside>
        </div>

        {/* --- Work area --- */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* The header is a band above the screen, unless the screen has
              claimed it (see HeaderSlot) - then it is rendered inside that
              screen's own scrolling column and travels with the cards. */}
          {/* Above the header on every screen, whether the header is a band
              here or claimed by the screen. */}
          {SERVER_BACKED && <LowCodesBanner hidden={pathname === '/account'} />}
          {SERVER_BACKED && <SetupPrompt />}

          {renderHeader(
          <header
            className={cx(
              'flex h-[68px] shrink-0 items-center justify-between gap-6',
              headerSlot ? 'px-0' : 'px-6',
            )}
          >
            <div className="min-w-0">
              <h1 className="truncate text-[17px] font-semibold tracking-[-0.01em] text-navy-900">
                {active
                  ? ((isNurse(install) ? NURSE_TITLES[active] : undefined) ?? TITLES[active])
                  : 'CHAS'}
              </h1>
              <div className="mt-1 flex items-center gap-2">
                <span className="truncate text-[11.5px] text-muted">
                  {(active && ((isNurse(install) ? NURSE_HINTS[active] : undefined) ?? HINTS[active])) ||
                    `S.Y. ${schoolYear}`}
                </span>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-3">
              {/* Everywhere but the roster. On the roster the field sits in
                  the toolbar, directly over the wall it narrows and beside the
                  filter it works with - and two fields doing one job, one of
                  them 60px above the other, is the thing this field was made
                  to fix in the first place. */}
              {active !== '/learners' && active !== '/weigh-in' && (
              <form onSubmit={submitSearch} className="relative hidden lg:block">
                <MagnifyingGlass
                  size={15}
                  className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-placeholder"
                />
                <input
                  ref={searchRef}
                  value={q}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="Search a learner or LRN   ( / )"
                  aria-label="Search learners"
                  className={cx(
                    'w-[236px] rounded-full bg-white py-2 pr-9 pl-9 xl:w-[276px]',
                    'text-[12.5px] text-ink placeholder:text-placeholder',
                    'shadow-[inset_0_0_0_1px_var(--color-line)]',
                    'transition-[box-shadow,background] duration-100',
                    'hover:shadow-[inset_0_0_0_1px_#ccd6e8] focus:outline-none',
                    'focus:shadow-[inset_0_0_0_1px_var(--color-navy-600),0_0_0_3px_rgba(43,82,196,0.14)]',
                  )}
                />
                {q && (
                  <button
                    type="button"
                    onClick={() => onSearchChange('')}
                    aria-label="Clear search"
                    className="absolute top-1/2 right-2.5 grid size-[22px] -translate-y-1/2 place-items-center rounded-full text-placeholder transition-colors duration-100 hover:bg-wash hover:text-navy-900"
                  >
                    <X size={12} weight="bold" />
                  </button>
                )}
                <button type="submit" className="sr-only">
                  Search
                </button>
              </form>
              )}

              <div className="flex items-center gap-2.5 rounded-full bg-white py-1 pr-3.5 pl-1 shadow-[0_1px_2px_rgba(14,36,100,0.06)]">
                <div className="grid size-8 place-items-center rounded-full bg-navy-700 text-[11.5px] font-semibold text-white">
                  {initials(install?.adviser)}
                </div>
                <div className="leading-tight">
                  <div className="text-[12px] font-semibold text-navy-900">
                    {install?.adviser ?? 'Not signed in'}
                  </div>
                  <div className="text-[10.5px] text-muted">
                    {install ? `${roleLabel(install)} · ${scopeLabel(install)}` : '-'}
                  </div>
                </div>
              </div>
            </div>
          </header>,
          )}

          {/* main owns the height and does not scroll. Each screen either fills
              it exactly (grid h-full, panels scroll internally) or scrolls its
              own root. No screen computes a height from 100vh: that is what put
              four panels 32px short of their neighbours. Screens carry their own
              padding so a scrolling screen's scrollbar sits at the true edge. */}
          <main className="min-h-0 flex-1 overflow-hidden">
            {/* The screens are split out of the entry bundle (see App.tsx),
                so each one is read off disk the first time it is opened. The
                fallback is an empty box of the right height rather than a
                spinner: a local read is a few milliseconds, and a spinner
                that appears and vanishes inside one frame is a flicker, not
                feedback. What it does do is hold main's height, so the
                sidebar and header do not reflow around a collapsed main. */}
            {/* The boundary sits OUTSIDE Suspense, and the order matters.
                Suspense waits for a promise; it does not catch a throw, and a
                lazy import that fails throws during render. Inside, it would
                never see the error and the whole tree would unmount into a
                blank page - which is exactly what a half-written build did.

                Keyed on the path so a screen that failed does not keep its
                error after the user navigates somewhere else. Without the
                key, one broken route poisons the work area until a reload. */}
            <ScreenBoundary key={pathname}>
              <Suspense fallback={<PageLoader />}>
                <HeaderSlot.Provider value={setHeaderSlot}>
                  {/* Until the records arrive a screen has nothing true to
                      show; a loader says so instead of a blank page. */}
                  {ready ? <Outlet /> : <PageLoader />}
                </HeaderSlot.Provider>
              </Suspense>
            </ScreenBoundary>
          </main>
          <Toaster />
        </div>
      </div>

      {/* Sign out asks first (2026-10-13): the button sits at the foot of the
          sidebar, where a stray click ends the session mid-weigh-in. */}
      <ConfirmDialog
        open={confirmSignOut}
        onOpenChange={setConfirmSignOut}
        title="Sign out of CHAS?"
        body="You will need to sign in again to continue. Anything not yet saved on this screen will be lost."
        confirmLabel="Sign out"
        onConfirm={() => void signOut()}
      />
    </div>
  )
}

/* Shown while a screen or its records load. It appears only after 300ms, so a
   fast load never flashes a spinner. */
function PageLoader() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="grid h-full place-items-center animate-[loader-in_200ms_ease-out_300ms_both]"
    >
      <div className="flex flex-col items-center gap-3 text-[12px] text-muted">
        <span className="size-7 animate-spin rounded-full border-[3px] border-navy-100 border-t-navy-600" />
        Loading…
      </div>
    </div>
  )
}

/* Recovery codes running low, said once per session after sign-in.

   Recovery codes are the only way back in that does not need the head (the
   head needs them most of all: the only head with none left and a forgotten
   password has nobody to reset it). So when a set is down to two, or was
   never made, the shell says so above every screen until it is dealt with
   or dismissed. Creating a new set on My account clears it - any write
   invalidates the query cache, and this refetches. */
function LowCodesBanner({ hidden }: { hidden: boolean }) {
  const navigate = useNavigate()
  const [dismissed, setDismissed] = useState(false)
  const codes = useQuery('recovery-codes', endpoints.recoveryCodes).data
  if (hidden || !codes || dismissed || codes.remaining > 2) return null

  const text =
    codes.total === 0
      ? 'No recovery codes yet. Create them in case you forget your password.'
      : codes.remaining === 0
        ? 'All recovery codes have been used. Create a new set in case you forget your password.'
        : `Only ${codes.remaining} recovery code${codes.remaining === 1 ? '' : 's'} left. Create a new set in case you forget your password.`

  return (
    <div className="shrink-0 px-6 pt-3">
      <div className="flex items-center gap-2.5 rounded-[14px] bg-gold-100 px-4 py-2 text-[12px] text-gold-700">
        <Key size={15} weight="fill" className="shrink-0" />
        <span className="min-w-0 flex-1">{text}</span>
        <button
          type="button"
          onClick={() => navigate('/account')}
          className="shrink-0 rounded-full bg-white px-3 py-1 text-[11.5px] font-semibold text-navy-900 transition-colors duration-100 hover:bg-navy-50"
        >
          Open My account
        </button>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setDismissed(true)}
          className="grid size-6 shrink-0 place-items-center rounded-full opacity-70 transition-opacity duration-100 hover:opacity-100"
        >
          <X size={12} weight="bold" />
        </button>
      </div>
    </div>
  )
}

/* An account with no recovery codes is asked to make them, in a dialog in the
   middle of the screen, right after sign-in. See RecoverySetupPrompt. */
function SetupPrompt() {
  const user = useQuery('me', endpoints.me).data?.user
  return <RecoverySetupPrompt user={user} />
}
