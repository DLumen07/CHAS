import { lazy } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import Shell from './components/Shell'
import Login from './screens/Login'
import { SERVER_BACKED } from './lib/records'

/* Every screen behind the door is split out of the entry bundle.

   The app shipped as one 545KB chunk, which meant the sign-in screen - the
   only thing on the display for the first second of every session - could not
   paint until the roster wall, the weigh-in keypad, the slip compositor and
   the barcode scanner had all been parsed. On the machine this actually runs
   on, a school laptop with an eMMC drive and no GPU worth the name, that is
   the difference the user experiences as "it takes a moment to open".

   Login stays a static import on purpose: it IS the first paint, so lazily
   loading it would add a round trip to the one screen that cannot afford one.

   Nothing is fetched over a network here. Electron loads these chunks off the
   local disk over file://, so a split is a cheaper read, never a request that
   can fail. */
const Admin = lazy(() => import('./screens/Admin'))
const Learners = lazy(() => import('./screens/Learners'))
const WeighIn = lazy(() => import('./screens/WeighIn'))
const Slips = lazy(() => import('./screens/Slips'))
const Attendance = lazy(() => import('./screens/Attendance'))
const SF8 = lazy(() => import('./screens/SF8'))
const SchoolYear = lazy(() => import('./screens/SchoolYear'))
/* The signed-in person's own email and recovery codes. Server build only:
   the local build has no accounts. */
const Account = lazy(() => import('./screens/Account'))
/* The school's name, School ID, district, division, region and logo. Head
   only, server build only: the local build keeps them as constants. */
const SchoolSettings = lazy(() => import('./screens/SchoolSettings'))
/* Two screens exist in two versions, chosen at build time by the same flag
   that chooses the store: Roles and Backup. Each pair does a genuinely
   different job rather than sharing one component behind an if - the local
   Roles edits names in a file and the server one creates accounts; local
   Backup writes the records file and the server one cannot honestly claim to
   back up a database at all. Sharing a component would mean every control
   carrying an if. */
const Roles = lazy(() =>
  SERVER_BACKED ? import('./screens/ServerRoles') : import('./screens/Roles'),
)
const Backup = lazy(() =>
  SERVER_BACKED ? import('./screens/ServerBackup') : import('./screens/Backup'),
)

// Held back for the first presentation, not deleted. The audit log and the
// settings screen rest on parts that are still stubs (no hash-chained writer,
// no SQLCipher key derivation), and a screen that states a guarantee the build
// cannot keep is worse than one that is not shown yet. Restore by uncommenting
// these lines and their routes below, plus the nav group in
// components/Shell.tsx.
//
// Attendance is no longer among them: it reads and writes the saved records
// like every other live screen, so it ships. Neither is SF8: it now reads the
// live roster and its release is gated on a review the nurse has to make in
// the same session, and the printed working copy says in its own footer which
// figures are CHAS's rather than the workbook's.
// const Audit = lazy(() => import('./screens/Audit'))
// const Settings = lazy(() => import('./screens/Settings'))

export default function App() {
  // HashRouter, not BrowserRouter: the production build is loaded over
  // file:// inside Electron, where path-based routing 404s.
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        {/* The Suspense boundary is INSIDE Shell, around its outlet, not out
            here around Shell itself. Out here it would unmount the sidebar and
            the header on every navigation and rebuild them a frame later,
            which reads as the whole window blinking each time a screen is
            opened for the first time. */}
        <Route element={<Shell />}>
          <Route path="/admin" element={<Admin />} />
          <Route path="/learners" element={<Learners />} />
          <Route path="/weigh-in" element={<WeighIn />} />
          <Route path="/slips" element={<Slips />} />
          <Route path="/attendance" element={<Attendance />} />
          <Route path="/sf8" element={<SF8 />} />
          {/* The school head's own screens. Each one redirects the nurse's
              install to the overview from inside the screen - the route
              existing is not the same as the screen describing something that
              install can see. */}
          <Route path="/roles" element={<Roles />} />
          <Route path="/backup" element={<Backup />} />
          {/* Moving the school to a new year needs the server's enrolment
              history, so the local build does not have it. */}
          {SERVER_BACKED && <Route path="/school-year" element={<SchoolYear />} />}
          {SERVER_BACKED && <Route path="/account" element={<Account />} />}
          {SERVER_BACKED && <Route path="/school-settings" element={<SchoolSettings />} />}
          {/* <Route path="/audit" element={<Audit />} /> */}
          {/* <Route path="/settings" element={<Settings />} /> */}
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
