const { app, BrowserWindow, dialog, ipcMain, session } = require('electron')
const store = require('./store.cjs')
const { printWithPreview, registerPrintPreview } = require('./print-preview.cjs')
const fs = require('node:fs/promises')
const { existsSync, appendFileSync, mkdirSync } = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

// The school workstation is a shared, offline machine. Nothing in this app
// should ever reach the network; the window is locked down accordingly.
const DEV_SERVER = process.env.CHAS_DEV_SERVER

/* The school server, when this install is a client of one rather than an
   offline machine keeping its own file.

   WHY A URL AND NOT A FLAG ON THE FILE BUILD. The offline build loads the app
   over file://, which is an opaque origin - so a fetch from that page to
   http://school-server:4000 is cross-SITE, and the session cookie is
   SameSite=Lax and simply is not sent. Sign-in appears to work and every
   request after it comes back 401. Pointing the window at the server, which
   serves both the app and the API (see APP_DIR in server/src/env.ts), puts
   the page and its API on ONE origin. The cookie is then first-party and
   behaves exactly as it does in the browser: no CORS, no SameSite exemption,
   and no token in localStorage standing in for a cookie that could not
   travel.

   Everything else about this process is unchanged. The window is still the
   same window, the preload still exposes the same channels, and printing to
   PDF still happens here - that is the reason this is a desktop app rather
   than a browser tab, and it does not care where the HTML came from. */
const APP_SERVER = process.env.CHAS_APP_SERVER

/* THE INSTALLED APP: the whole of CHAS on this one machine.

   A school installs CHAS on one computer, and that computer is the whole
   deployment. So the installer carries the server too: server-bundle/ holds
   the API, a private PostgreSQL and the built app (see
   scripts/build-desktop-server.mjs and server/desktop.ts). On launch this
   process starts it, on 127.0.0.1 only, and opens the window on it - the same
   one-origin arrangement as CHAS_APP_SERVER above, with the server on the same
   machine instead of across the school network. Nothing is reached over the
   network, and nothing on the network can reach it.

   Used whenever neither of the two overrides above is set and the bundle is
   there: always, in an installed copy. In development it is there after
   `npm run build:desktop`. Without it, the window falls back to dist/ on
   disk, which is the old single-file local store. */
const DESKTOP_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'server')
  : require('./bundle-dir.cjs')
const DESKTOP =
  !DEV_SERVER && !APP_SERVER && existsSync(path.join(DESKTOP_DIR, 'desktop.mjs'))

/* The running local server, once it is up; stopped on quit. */
let desktop = null

/* One log for the installed app, because a school laptop has no terminal to
   read and "it would not open" is otherwise all anybody can report. */
function logLine(line) {
  try {
    const dir = path.join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    appendFileSync(path.join(dir, 'chas.log'), `${new Date().toISOString()} ${line}\n`)
  } catch {
    /* Logging must never be the reason the app fails. */
  }
  if (!app.isPackaged) console.log(line)
}

/* Shown while the database starts: under a second on most days, about
   fifteen on the very first launch while it is created. */
const STARTING_PAGE =
  'data:text/html;charset=utf-8,' +
  encodeURIComponent(`<!doctype html><meta charset="utf-8"><title>CHAS</title>
<style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#eceff5;
font:14px 'Segoe UI',system-ui,sans-serif;color:#5a6b85}
.c{text-align:center}.t{font-size:20px;font-weight:700;color:#0e2464}
.s{margin:18px auto 0;width:28px;height:28px;border-radius:50%;border:3px solid #dae2f8;
border-top-color:#1e3fa0;animation:r .9s linear infinite}@keyframes r{to{transform:rotate(1turn)}}</style>
<div class="c"><div class="t">Starting CHAS…</div>
<div style="margin-top:6px">The first start after installing takes a little longer.</div><div class="s"></div></div>`)

/* Draw on the CPU.

   This machine reports ANGLE on Direct3D11 over AMD integrated graphics, and
   that combination flickers: whole-window flashes as Chromium's GPU
   compositor swaps surfaces. Vulkan is not an option to switch to - the
   driver reports vulkanVersion "Not supported" - and D3D11 is already what
   ANGLE is using, so there is no better backend to pick.

   What this app draws is a static form: text, rules, filled rectangles, one
   SVG donut. There is no video, no canvas animation and no 3D, so the GPU is
   buying nothing here, and a school workstation is exactly where an unknown
   driver should not be in the paint path. Software compositing renders this
   identically on every machine it will ever be demonstrated on.

   To put the GPU back, delete this line. Do it only with a machine in front
   of you to re-test the flicker on. */
app.disableHardwareAcceleration()

/* `localUrl` is the in-process server's address when this is the installed
   app (DESKTOP), and absent otherwise. */
function createWindow(localUrl) {
  const win = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1180,
    minHeight: 700,
    backgroundColor: '#ffffff',
    show: false,
    autoHideMenuBar: true,
    title: 'CHAS — Child Health Assessment System',
    /* The CHAS logo in the title bar and taskbar. The installed .exe carries
       the same icon (brand/icon.ico); this one also covers `npm run dev`. */
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })

  /* Always opens maximized. maximize() before the first show, so the window
     appears at full size instead of growing from 1366x768 on screen. */
  win.once('ready-to-show', () => {
    win.maximize()
    win.show()
  })

  // Refuse to navigate anywhere but our own bundle, and never open popups.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  /* Wherever this window was loaded from is the only place it may navigate.

     The origin to compare against is now one of three - the dev server, the
     school server, or the bundle on disk - so it is stated once here rather
     than re-derived at each call site. The bug this replaces was quieter than
     it looks: with a school server configured, the old expression fell
     through to `startsWith('file://')` and would have blocked the app's own
     first in-page navigation.

     `shell.openExternal` on the line below used to be referenced and never
     called, which reads as "open it in the real browser" and does nothing at
     all. A navigation to an unknown origin from a health-records app is not
     something to be helpfully forwarded anywhere; it is refused and logged. */
  const HOME = DEV_SERVER || APP_SERVER || localUrl || 'file://'
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(HOME)) {
      event.preventDefault()
      console.warn(`[chas] blocked navigation to ${url}`)
    }
  })

  if (DEV_SERVER) {
    win.loadURL(DEV_SERVER)
    win.webContents.openDevTools({ mode: 'detach' })
  } else if (APP_SERVER) {
    /* The school-server build. See the note on APP_SERVER above for why this
       is a URL and not a file. */
    win.loadURL(APP_SERVER)
  } else if (localUrl) {
    win.loadURL(localUrl)
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
  return win
}

/* The installed app's start: the starting page at once, then the local
   server, then the app in the same window. A failure is shown to the person
   who double-clicked the icon, with where the log is, and the app quits
   rather than leaving a window that can never finish loading. */
async function startInstalledApp() {
  const splash = new BrowserWindow({
    width: 460,
    height: 260,
    frame: false,
    resizable: false,
    show: true,
    backgroundColor: '#eceff5',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  splash.loadURL(STARTING_PAGE)

  try {
    const { startDesktop } = await import(pathToFileURL(path.join(DESKTOP_DIR, 'desktop.mjs')).href)
    desktop = await startDesktop({
      /* CHAS_DATA_DIR is for testing a first launch without touching the
         real records; nobody sets it on a school machine. */
      dataDir: process.env.CHAS_DATA_DIR || path.join(app.getPath('userData'), 'database'),
      appDir: path.join(DESKTOP_DIR, 'app'),
      migrationsDir: path.join(DESKTOP_DIR, 'migrations'),
      log: logLine,
    })
    const win = createWindow(desktop.url)
    win.once('ready-to-show', () => splash.destroy())
  } catch (err) {
    logLine(`[chas] could not start: ${err && err.stack ? err.stack : err}`)
    splash.destroy()
    /* Plain steps for the person at the keyboard; the technical reason is
       in the log for whoever supports the school. */
    dialog.showErrorBox(
      'CHAS could not start',
      `Close CHAS, restart the computer, and open CHAS again. Saved records are not affected.\n\nIf this keeps happening, give this file to the person who installed CHAS:\n${path.join(app.getPath('userData'), 'logs', 'chas.log')}`,
    )
    app.quit()
  }
}

// One record, one workstation: a second instance would race the database.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  /* Set once the database is being stopped for good (see will-quit). */
  let stopped = false

  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    /* No web permission is ever granted: camera, microphone, location,
       notifications, clipboard, HID, serial and the rest. CHAS uses none of
       them, so a page that asks is a page doing something it should not.
       Electron's default is to grant every request. */
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))

    /* The renderer never touches the filesystem itself: it asks through
       these channels and nothing else. */
    ipcMain.handle('chas:records:load', () => store.load())
    ipcMain.handle('chas:records:save', (_e, data) => store.save(data))
    ipcMain.handle('chas:records:path', () => store.FILE())

    /* Slip export. The renderer puts the sheets it wants on paper into
       #print-root and asks for a PDF; Chromium renders the same page under
       the print stylesheet, so the file is the printout, not a screenshot of
       it. `preferCSSPageSize` hands the page size to the @page rule in
       index.css, which is the single place the half-sheet size is declared.

       The file is written by the main process after a save dialog: the
       renderer never gets a path it could write to on its own. */
    ipcMain.handle('chas:print:pdf', async (event, opts = {}) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return { ok: false, reason: 'error', message: 'no window' }

      const suggested = String(opts.suggestedName || 'slips.pdf').replace(/[\\/:*?"<>|]/g, '-')
      const chosen = await dialog.showSaveDialog(win, {
        title: typeof opts.title === 'string' && opts.title ? opts.title : 'Save advisory slips',
        defaultPath: path.join(app.getPath('documents'), suggested),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      })
      if (chosen.canceled || !chosen.filePath) return { ok: false, reason: 'canceled' }

      try {
        const data = await win.webContents.printToPDF({
          printBackground: true,
          preferCSSPageSize: true,
          pageSize: { width: 8.5, height: 5.5 },
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        })
        await fs.writeFile(chosen.filePath, data)
        return { ok: true, path: chosen.filePath }
      } catch (err) {
        console.error('[chas] could not write the slip PDF', err)
        return { ok: false, reason: 'error', message: String(err && err.message) }
      }
    })

    /* Print with a preview first (print-preview.cjs). The Windows print
       dialog that window.print() opened could not show one. */
    registerPrintPreview()
    ipcMain.handle('chas:print:paper', async (event, opts = {}) => {
      try {
        return await printWithPreview(event.sender, opts)
      } catch (err) {
        console.error('[chas] could not open the print preview', err)
        return { ok: false, reason: 'error', message: String(err && err.message) }
      }
    })

    /* The SF8 template, for the PDF export. The renderer reads the form's
       cut-off tables and header pictures out of it (src/lib/sf8.ts) and the
       PDF itself goes through chas:print:pdf above. Handed over from here
       rather than fetched, because the offline build's page is file:// and
       Chromium will not fetch a file: URL. */
    ipcMain.handle('chas:sf8:template', () =>
      fs.readFile(path.join(__dirname, 'templates', 'sf8-template.xlsx')),
    )

    /* Backup and restore of the installed app's database. The folder is
       always chosen in a system dialog here; the renderer never names a path.
       Both answer { ok: false, reason: 'unavailable' } outside the installed
       app, where there is no local database to copy. */
    ipcMain.handle('chas:backup:status', () => ({
      available: Boolean(desktop),
      lastRestore: desktop ? desktop.lastRestore() : null,
      lastAutomatic: desktop ? desktop.lastAutomatic() : null,
    }))

    ipcMain.handle('chas:backup:create', async (event) => {
      if (!desktop) return { ok: false, reason: 'unavailable' }
      const win = BrowserWindow.fromWebContents(event.sender)
      const chosen = await dialog.showOpenDialog(win, {
        title: 'Choose where to save the backup (a USB drive is best)',
        defaultPath: app.getPath('documents'),
        buttonLabel: 'Save backup here',
        properties: ['openDirectory', 'createDirectory'],
      })
      if (chosen.canceled || !chosen.filePaths[0]) return { ok: false, reason: 'canceled' }
      try {
        const result = await desktop.backupTo(chosen.filePaths[0])
        return { ok: true, ...result }
      } catch (err) {
        logLine(`[chas] backup failed: ${err && err.stack ? err.stack : err}`)
        return { ok: false, reason: 'error', message: String(err && err.message) }
      }
    })

    ipcMain.handle('chas:backup:restore', async (event) => {
      if (!desktop) return { ok: false, reason: 'unavailable' }
      const win = BrowserWindow.fromWebContents(event.sender)
      const chosen = await dialog.showOpenDialog(win, {
        title: 'Choose the CHAS-backup folder to restore',
        /* Opens on the automatic backups, the usual place to undo a mistake
           from; a USB drive is one click away in the same dialog. */
        defaultPath: existsSync(desktop.automaticFolder) ? desktop.automaticFolder : app.getPath('documents'),
        buttonLabel: 'Restore this backup',
        properties: ['openDirectory'],
      })
      if (chosen.canceled || !chosen.filePaths[0]) return { ok: false, reason: 'canceled' }
      const folder = chosen.filePaths[0]

      /* The last word is the system's own dialog, not a button in the page:
         this replaces every record on the machine. */
      const confirm = await dialog.showMessageBox(win, {
        type: 'warning',
        title: 'Restore this backup?',
        message: 'Replace the records on this computer with the backup?',
        detail: `${folder}\n\nEverything saved since that backup was made will be replaced. A copy of the current records is kept on this computer in case the backup will not open. CHAS will restart.`,
        buttons: ['Restore and restart', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
      })
      if (confirm.response !== 0) return { ok: false, reason: 'canceled' }

      try {
        await desktop.restoreFrom(folder)
      } catch (err) {
        logLine(`[chas] restore failed: ${err && err.stack ? err.stack : err}`)
        return { ok: false, reason: 'error', message: String(err && err.message) }
      }
      /* The database is already stopped; quit without stopping it again and
         start fresh on the restored copy. */
      stopped = true
      app.relaunch()
      app.exit(0)
      return { ok: true }
    })

    if (DESKTOP) void startInstalledApp()
    else createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(desktop && desktop.url)
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  /* Stop PostgreSQL before the process ends. Left running, it would hold the
     database until the next reboot, and the next launch would have to find
     and stop it first. The quit is held for the clean shutdown and the
     automatic backup made with it - a few seconds, after the window has
     already closed - then let through. Opening CHAS again in those seconds
     is safe: the new one waits for this one to finish (see
     waitForPreviousClose in server/desktop.ts). */
  app.on('will-quit', (event) => {
    if (!desktop || stopped) return
    event.preventDefault()
    stopped = true
    desktop
      .stop()
      .catch((err) => logLine(`[chas] database did not stop cleanly: ${err}`))
      .finally(() => app.quit())
  })
}
