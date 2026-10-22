const { contextBridge, ipcRenderer } = require('electron')

/* The print preview window's controls panel (print-preview.html). It can
   read what is being printed, print it, or close; nothing else. */
contextBridge.exposeInMainWorld('preview', {
  info: () => ipcRenderer.invoke('chas:preview:info'),
  print: (deviceName, copies) => ipcRenderer.invoke('chas:preview:print', { deviceName, copies }),
  cancel: () => ipcRenderer.invoke('chas:preview:cancel'),
})
