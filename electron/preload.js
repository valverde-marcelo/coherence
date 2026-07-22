'use strict'
const { contextBridge, ipcRenderer } = require('electron')

// Superfície de API mínima exposta ao renderer (sandboxed, sem Node/fs direto).
contextBridge.exposeInMainWorld('api', {
  getIdentity: () => ipcRenderer.invoke('identity:get'),
  getProfile: () => ipcRenderer.invoke('profile:get'),
  setDisplayName: (displayName) => ipcRenderer.invoke('profile:setDisplayName', { displayName }),
  searchUsers: (query) => ipcRenderer.invoke('users:search', { query }),
  createPost: (text, mediaPaths) => ipcRenderer.invoke('post:create', { text, mediaPaths }),
  getFeed: () => ipcRenderer.invoke('feed:get'),
  listFollows: () => ipcRenderer.invoke('follow:list'),
  addFollow: (pubkeyHex, alias) => ipcRenderer.invoke('follow:add', { pubkeyHex, alias }),
  removeFollow: (pubkeyHex) => ipcRenderer.invoke('follow:remove', { pubkeyHex }),
  getStats: () => ipcRenderer.invoke('stats:get'),
  pickImages: () => ipcRenderer.invoke('dialog:pickImages'),
  readMedia: (pubkeyHex, isOwn, sha256, mime) => ipcRenderer.invoke('media:read', { pubkeyHex, isOwn, sha256, mime }),
  // Chapter event listeners (for real-time progress)
  onChapterPostAdded: (callback) => ipcRenderer.on('chapter:post-added', (_e, data) => callback(data)),
  onChapterSealing: (callback) => ipcRenderer.on('chapter:sealing', (_e, data) => callback(data)),
  onChapterSaved: (callback) => ipcRenderer.on('chapter:saved', (_e, data) => callback(data)),
  onChapterSeeding: (callback) => ipcRenderer.on('chapter:seeding', (_e, data) => callback(data)),
  onChapterSeedingStarted: (callback) => ipcRenderer.on('chapter:seeding-started', (_e, data) => callback(data)),
  onChapterRateLimited: (callback) => ipcRenderer.on('chapter:rate-limited', (_e, data) => callback(data)),
  i18n: {
    t: (key, defaultValue) => ipcRenderer.invoke('i18n:translate', { key, defaultValue }),
    setLang: (lang) => ipcRenderer.invoke('i18n:setLang', { lang }),
    getCurrentLang: () => ipcRenderer.invoke('i18n:getCurrentLang'),
    getAvailableLanguages: () => ipcRenderer.invoke('i18n:getAvailableLanguages'),
    pluralize: (count, keyPrefix) => ipcRenderer.invoke('i18n:pluralize', { count, keyPrefix }),
    formatString: (template, values) => ipcRenderer.invoke('i18n:formatString', { template, values }),
    getLanguageLabel: (lang) => ipcRenderer.invoke('i18n:getLanguageLabel', { lang })
  },
  backup: {
    exportBackup: (password) => ipcRenderer.invoke('backup:export', { password }),
    importBackup: (zipData, password) => ipcRenderer.invoke('backup:import', { zipData, password }),
    openBackupsFolder: () => ipcRenderer.invoke('backup:openFolder')
  }
})
