'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pickerApi', {
  onAccounts: (callback) => {
    ipcRenderer.on('picker:accounts', (_evt, keys) => callback(keys))
  },
  choose: (key) => ipcRenderer.send('picker:choose', key),
  cancel: () => ipcRenderer.send('picker:cancel')
})
