/* Does the Electron client actually work against the school server?

   The offline smoke test (smoke-electron.cjs) answers a different question:
   whether the lazy chunks load over file://. This one answers the question
   that file:// cannot even ask - whether a session survives.

   WHY IT EXISTS. The desktop build used to load the app from disk. A page on
   a file:// origin fetching http://server:4000 is cross-SITE, so the
   SameSite=Lax session cookie is never sent: sign-in returns 200 and sets a
   cookie, and every request after it comes back 401. That failure looks
   exactly like a wrong passphrase from the outside, and it cannot be caught
   by testing the API with curl, because curl has no same-site rules. It has
   to be driven from a real Chromium renderer.

   So this harness opens the real window, at the real URL, signs in through
   the real form, and then asks the page - from inside itself - whether the
   API still knows who it is. Run with:

     npm run smoke:server

   It needs the server up with APP_DIR set, and an account to sign in as. */

const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')

/* The renderer still asks for the local records file even on a server build,
   and that is not a bug here: announcements are kept in it, and useRoster()
   calls both stores unconditionally so the hook order can never change (see
   the note at the bottom of src/lib/records.ts). Answering in memory rather
   than registering the real store, for the same reason the offline harness
   does: a smoke test must not read or write the tester's own
   chas-records.json and then pass or fail on whatever is in it today. */
const memory = {
  version: 4,
  savedAt: null,
  measurements: {},
  absences: {},
  immunizations: {},
  slips: {},
  staff: {},
  announcements: [],
  meeting: null,
  install: null,
}
ipcMain.handle('chas:records:load', () => memory)
ipcMain.handle('chas:records:save', () => ({ ok: true, path: '(smoke test, nothing written)' }))
ipcMain.handle('chas:records:path', () => '(smoke test, nothing written)')

const URL = process.env.CHAS_APP_SERVER || 'http://localhost:4000'
const USER = process.env.CHAS_SMOKE_USER || 'a.bantolo'
const PASS = process.env.CHAS_SMOKE_PASS || 'chas-dev-passphrase-2026'

const ROUTES = ['/admin', '/learners', '/roles', '/backup']
const problems = []

app.disableHardwareAcceleration()

/** Poll the page until `expr` is truthy, or give up. */
async function until(win, expr, ms = 8000) {
  const deadline = Date.now() + ms
  for (;;) {
    const got = await win.webContents.executeJavaScript(expr)
    if (got) return got
    if (Date.now() > deadline) return null
    await new Promise((r) => setTimeout(r, 150))
  }
}

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
    if (level === 3) problems.push(`renderer error: ${message}`)
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    problems.push(`did-fail-load ${code} ${desc} ${url}`)
  })

  try {
    await win.loadURL(URL)
  } catch (err) {
    console.log(`[chas] could not load ${URL}: ${err.message}`)
    console.log('       Is the server running with APP_DIR set?')
    app.exit(1)
    return
  }
  console.log(`[chas] loaded ${URL}`)

  /* The sign-in form is the first paint, so it is there or the bundle did not
     arrive. */
  const ready = await until(win, `!!document.querySelector('input[type=password]')`)
  if (!ready) {
    problems.push('the sign-in form never rendered - the app bundle did not load')
  } else {
    /* Typed the way React notices: setting .value directly updates the DOM
       node and leaves React's state untouched, so the form would submit two
       empty fields. */
    await win.webContents.executeJavaScript(`
      (() => {
        const set = (el, v) => {
          const p = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
          p.call(el, v)
          el.dispatchEvent(new Event('input', { bubbles: true }))
        }
        set(document.querySelector('input:not([type=password])'), ${JSON.stringify(USER)})
        set(document.querySelector('input[type=password]'), ${JSON.stringify(PASS)})
        document.querySelector('form').requestSubmit()
        return true
      })()
    `)

    const signedIn = await until(win, `location.hash === '#/admin' || location.hash === '#/dashboard'`)
    if (!signedIn) problems.push(`sign-in did not navigate away from the door (hash ${await win.webContents.executeJavaScript('location.hash')})`)
    else console.log(`  ok   signed in as ${USER}`)
  }

  /* THE POINT OF THE WHOLE FILE. Ask the API, from the page, who it thinks we
     are. Over file:// this is the call that comes back 401 with a cookie
     sitting unused in the jar. */
  const me = await win.webContents.executeJavaScript(`
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json().then((b) => ({ status: r.status, username: b.user && b.user.username })))
      .catch((e) => ({ status: 0, error: String(e) }))
  `)
  if (me.status === 200 && me.username) {
    console.log(`  ok   the session survives a fetch from the page (as ${me.username})`)
  } else {
    problems.push(`/api/auth/me from the renderer returned ${me.status} - the session cookie is not being sent`)
  }

  for (const route of ROUTES) {
    await win.webContents.executeJavaScript(`location.hash = '#${route}'`)
    const chars = await until(
      win,
      `((document.querySelector('main') || {}).innerText || '').trim().length > 40 ? ((document.querySelector('main')||{}).innerText||'').trim().length : 0`,
    )
    console.log(`  ${chars ? 'ok  ' : 'FAIL'} ${route.padEnd(15)} ${chars || 0} chars rendered`)
    if (!chars) problems.push(`${route} rendered nothing`)
  }

  if (problems.length) {
    console.log(`\n[chas] SERVER SMOKE FAILED - ${problems.length} problem(s):`)
    for (const p of problems) console.log(`  - ${p}`)
    app.exit(1)
  } else {
    console.log('\n[chas] server smoke passed: the desktop client is a real client of the API')
    app.exit(0)
  }
})
