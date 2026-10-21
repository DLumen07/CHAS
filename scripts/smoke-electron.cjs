/* Does the packaged build actually load, and do its lazy chunks arrive?

   Route-level code splitting (App.tsx) turned one bundle into eight files that
   the renderer fetches with dynamic `import()`. In a browser that is
   uncontroversial. Inside Electron the page is loaded with `loadFile`, so its
   origin is `file://` - and a `file://` origin is opaque, which is exactly the
   situation where Chromium has historically refused to fetch a module. A
   split that works in `npm run dev:renderer` and fails in the installer would
   not show up until somebody double-clicked the .exe.

   So this harness opens the real dist/index.html in a real BrowserWindow with
   the real preload, forwards everything the renderer says to stdout, drives
   the router through every lazy route, and exits non-zero if anything failed
   to load. It is a smoke test, not a UI test: it answers "did the chunks
   arrive and did React mount", nothing more.

   Run with:  npm run smoke
*/

const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')

app.disableHardwareAcceleration()

/* Every route behind the shell, so each lazily-imported chunk is actually
   requested. A route whose chunk fails to load renders nothing and logs a
   fetch error, which the listeners below catch. */
const ROUTES = [
  '/admin',
  '/learners',
  '/weigh-in',
  '/slips',
  '/attendance',
  '/sf8',
  '/roles',
  '/backup',
]

const problems = []

/* An IN-MEMORY records store, standing in for electron/store.cjs.

   The renderer asks for its records over IPC and renders nothing behind the
   shell if the answer never comes. In memory rather than the real store,
   because a smoke test must not write to the tester's own
   chas-records.json - or read it, and then report a pass or a fail that
   depends on whatever happens to be in it today.

   Pre-claimed as the head's install, which is the only one that reaches
   every route: the school overview, the roles table, the notices and the
   backup screen all redirect an adviser to her dashboard. /dashboard is
   therefore NOT in the list above - on this install it redirects to /admin,
   so asking for it would prove nothing about its chunk. */
const fakeRecords = {
  version: 4,
  savedAt: null,
  measurements: {},
  absences: {},
  immunizations: {},
  slips: {},
  staff: {},
  announcements: [],
  meeting: null,
  install: { adviser: 'Mrs. A. Bantolo', section: '', role: 'admin' },
}

ipcMain.handle('chas:records:load', () => fakeRecords)
ipcMain.handle('chas:records:save', () => ({ ok: true, path: '(smoke test, nothing written)' }))
ipcMain.handle('chas:records:path', () => '(smoke test, nothing written)')

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1366,
    height: 768,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.webContents.on('console-message', (_e, level, message) => {
    console.log(`[renderer] ${message}`)
    /* level 3 is error. Chromium reports a failed dynamic import as an
       uncaught TypeError in the renderer, which is the signal this whole
       harness exists to catch. */
    if (level === 3) problems.push(message)
  })

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    problems.push(`did-fail-load ${code} ${desc} ${url}`)
  })

  win.webContents.on('preload-error', (_e, p, err) => {
    problems.push(`preload-error ${p}: ${err.message}`)
  })

  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))

  /* The install arrives over IPC from `fakeRecords` above, so there is
     nothing to seed here - only to wait for. Every route behind the shell
     redirects to sign-in without one, and the first version of this harness
     registered no IPC handlers at all: the renderer's request went
     unanswered, the shell bounced all six routes to sign-in, and the harness
     reported six failed chunks when in fact every chunk had loaded. */
  await new Promise((r) => setTimeout(r, 1200))

  /* WHICH BUILD IS IN dist/, before blaming the chunks.

     This harness tests the OFFLINE build: it fakes the local record store
     over IPC and expects the app to believe it. A build made with
     VITE_CHAS_BACKEND=server ignores that store entirely, asks an API that is
     not there, stays signed out, and redirects all nine routes to the door -
     which this file would otherwise report as nine failed chunks, sending
     whoever reads it to look for a code-splitting problem that does not
     exist.

     The build states which it is on the document element - see main.tsx. It
     used to be detected by matching a sentence on the sign-in screen, which
     worked until that screen was redesigned and the sentence rewritten, at
     which point this guard silently stopped detecting anything. A test whose
     check depends on prose breaks when a writer changes a word.

     Rebuild with `npm run build:offline` for the artifact this harness wants,
     or run `npm run smoke:server` if the server build is the one you meant to
     test. */
  const isServerBuild = await win.webContents.executeJavaScript(
    `document.documentElement.dataset.backend === 'server'`,
  )
  if (isServerBuild) {
    console.log('\n[chas] dist/ holds a SERVER build, and this harness tests the offline one.')
    console.log('       Run `npm run build:offline` for the offline artifact, or `npm run smoke:server`')
    console.log('       to test the desktop client against a running API.\n')
    app.exit(2)
    return
  }

  /* How long a route may take to paint before it is called a failure, and
     how often to look.

     POLL, don't sleep. This was a flat 900ms wait per route, which is a race
     the harness loses whenever the machine is busy - and the machine IS busy
     in the one situation you most want to run this, with a dev server and an
     Electron window already open. It failed /learners and /weigh-in on one
     run and passed both on the next with no code change in between, which is
     worse than a slow test: a check that cries wolf is a check people learn
     to re-run rather than read.

     So it asks every 150ms and stops the moment the route has painted. The
     ceiling is generous because it is only ever reached by a route that has
     genuinely failed, and a fast machine still finishes the whole sweep in
     about a second. */
  const ROUTE_TIMEOUT_MS = 6000
  const POLL_MS = 150

  for (const route of ROUTES) {
    await win.webContents.executeJavaScript(`location.hash = '#${route}'`)

    const deadline = Date.now() + ROUTE_TIMEOUT_MS
    let seen
    for (;;) {
      await new Promise((r) => setTimeout(r, POLL_MS))
      seen = await win.webContents.executeJavaScript(`
        ({
          hash: location.hash,
          chars: (document.querySelector('main')?.innerText ?? '').trim().length,
        })
      `)
      if (seen.chars > 40 || Date.now() > deadline) break
    }

    /* An empty <main> is the signature of a chunk that did not arrive: the
       Suspense fallback is an empty div, so a failed import leaves the shell
       painted and the work area blank rather than throwing anything visible. */
    const ok = seen.chars > 40
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${route.padEnd(12)} ${seen.chars} chars rendered`)
    if (!ok) problems.push(`${route} rendered ${seen.chars} chars - chunk likely failed to load`)
  }

  if (problems.length) {
    console.log(`\n[chas] SMOKE FAILED - ${problems.length} problem(s):`)
    for (const p of problems) console.log(`  - ${p}`)
    app.exit(1)
  } else {
    console.log('\n[chas] smoke passed: every lazy route loaded from file://')
    app.exit(0)
  }
})
