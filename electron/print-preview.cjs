const { BrowserWindow, WebContentsView, app, ipcMain } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { pathToFileURL } = require('node:url')

/* Printing with a preview (2026-10-22, the user's request).

   window.print() in Electron opens the Windows print dialog, and that dialog
   cannot show a preview for an Electron app ("This app doesn't support print
   preview"). So Print opens this window instead:

     - the page is rendered under the print stylesheet with printToPDF, the
       same call Save PDF uses, so the preview is exactly what comes out;
     - the right side shows that PDF in Chromium's own viewer, in a view of
       its own (a PDF only renders as a top-level page, not in a frame);
     - the left side (print-preview.html) has the printer, the number of
       copies, Print and Cancel;
     - Print sends the SAME page to the chosen printer, silently, at the
       paper size the PDF came out at. The PDF itself is never printed:
       Electron cannot print from its PDF viewer.

   The temporary PDF is deleted when the window closes. */

const PANEL = 320

/** Page count and the first page's size in microns, from the PDF Chromium
    wrote. Skia writes a plain page tree, so these are found as text. */
function pdfFacts(data) {
  const s = Buffer.from(data).toString('latin1')
  const pages = (s.match(/\/Type\s*\/Page(?![a-z])/gi) || []).length
  const box = s.match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/)
  const micron = (pt) => Math.round((pt * 25400) / 72)
  const pageSize = box
    ? { width: micron(Number(box[3]) - Number(box[1])), height: micron(Number(box[4]) - Number(box[2])) }
    : null
  return { pages, pageSize }
}

let current = null

/** Opens the preview for `source` and resolves when it is printed or closed. */
async function printWithPreview(source, opts = {}) {
  const parent = BrowserWindow.fromWebContents(source)
  if (!parent) return { ok: false, reason: 'error', message: 'no window' }
  if (current) {
    current.win.focus()
    return { ok: false, reason: 'canceled' }
  }

  const data = await source.printToPDF({
    printBackground: true,
    preferCSSPageSize: true,
    pageSize: { width: 8.5, height: 5.5 },
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
  })
  const { pages, pageSize } = pdfFacts(data)
  const file = path.join(app.getPath('temp'), `chas-print-${randomUUID()}.pdf`)
  await fs.writeFile(file, data)

  const printers = (await source.getPrintersAsync()).map((p) => ({
    name: p.name,
    displayName: p.displayName || p.name,
    isDefault: Boolean(p.isDefault),
  }))

  const win = new BrowserWindow({
    parent,
    modal: true,
    width: Math.min(1180, parent.getBounds().width - 80),
    height: Math.min(820, parent.getBounds().height - 80),
    minWidth: 760,
    minHeight: 480,
    show: false,
    title: 'Print',
    autoHideMenuBar: true,
    minimizable: false,
    backgroundColor: '#fbfcfe',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'print-preview-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  const pdfView = new WebContentsView({
    webPreferences: { plugins: true, sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  pdfView.setBackgroundColor('#525659')
  pdfView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.contentView.addChildView(pdfView)
  const layout = () => {
    const { width, height } = win.getContentBounds()
    pdfView.setBounds({ x: PANEL, y: 0, width: Math.max(0, width - PANEL), height })
  }
  layout()
  win.on('resize', layout)

  return new Promise((resolve) => {
    let result = { ok: false, reason: 'canceled' }
    current = {
      win,
      info: {
        title: typeof opts.title === 'string' && opts.title ? opts.title : 'Document',
        pages,
        printers,
      },
      print: (deviceName, copies) =>
        new Promise((done) => {
          source.print(
            {
              silent: true,
              deviceName,
              copies,
              printBackground: true,
              ...(pageSize ? { pageSize } : {}),
            },
            (success, failureReason) => done(success ? { ok: true } : { ok: false, message: failureReason }),
          )
        }),
      finish: (r) => {
        result = r
        win.close()
      },
    }

    win.once('ready-to-show', () => win.show())
    win.on('closed', () => {
      current = null
      void fs.rm(file, { force: true })
      resolve(result)
    })

    void win.loadFile(path.join(__dirname, 'print-preview.html'))
    void pdfView.webContents.loadURL(`${pathToFileURL(file).href}#toolbar=0&view=Fit`)
  })
}

/* The preview window's own channels. Only that window may use them. */
function registerPrintPreview() {
  const fromPreview = (event) => current && event.sender === current.win.webContents

  ipcMain.handle('chas:preview:info', (event) => (fromPreview(event) ? current.info : null))

  ipcMain.handle('chas:preview:print', async (event, opts = {}) => {
    if (!fromPreview(event)) return { ok: false, message: 'not allowed' }
    const names = current.info.printers.map((p) => p.name)
    const deviceName = names.includes(opts.deviceName) ? opts.deviceName : undefined
    if (!deviceName) return { ok: false, message: 'Select a printer.' }
    const copies = Math.min(99, Math.max(1, Math.floor(Number(opts.copies) || 1)))
    const res = await current.print(deviceName, copies)
    if (res.ok) current.finish({ ok: true, printer: deviceName })
    return res
  })

  ipcMain.handle('chas:preview:cancel', (event) => {
    if (fromPreview(event)) current.finish({ ok: false, reason: 'canceled' })
  })
}

module.exports = { printWithPreview, registerPrintPreview }
