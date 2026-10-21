const { contextBridge, ipcRenderer } = require('electron')

/* The renderer gets these calls and no direct node access. Everything that
   touches the disk happens in the main process: records in store.cjs, the
   slip PDF in main.cjs behind a save dialog. */
contextBridge.exposeInMainWorld('chas', {
  platform: process.platform,
  version: process.versions.electron,
  records: {
    load: () => ipcRenderer.invoke('chas:records:load'),
    save: (data) => ipcRenderer.invoke('chas:records:save', data),
    path: () => ipcRenderer.invoke('chas:records:path'),
  },
  print: {
    /** Render the current page under the print stylesheet and save it. */
    pdf: (opts) => ipcRenderer.invoke('chas:print:pdf', opts),
  },
  backup: {
    /** Whether this is the installed app, and how the last restore went. */
    status: () => ipcRenderer.invoke('chas:backup:status'),
    /** Copy the database to a folder the person picks. */
    create: () => ipcRenderer.invoke('chas:backup:create'),
    /** Replace the database with a backup folder; the app restarts. */
    restore: () => ipcRenderer.invoke('chas:backup:restore'),
  },
  sf8: {
    /** The school's SF8 template, for the PDF export to read its tables. */
    template: () => ipcRenderer.invoke('chas:sf8:template'),
  },
})
