'use strict'
const path = require('path')
const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require('electron')
const { initLogger } = require('../src/main/logger')
const { App } = require('../src/main/app')
const { createTranslator } = require('../src/i18n/translator')

// Inicia logging para arquivo
initLogger()

let mainWindow
/** @type {App} */
let socialApp

// i18n state
let translator = null
const localeNames = ['pt-BR', 'en']
const localesData = {}

// Load all locale files
function loadLocales () {
  for (const langCode of localeNames) {
    try {
      const localeFile = path.join(__dirname, '..', 'locales', `${langCode}.json`)
      const fs = require('fs')
      localesData[langCode] = JSON.parse(fs.readFileSync(localeFile, 'utf-8'))
    } catch (err) {
      console.error(`Failed to load locale ${langCode}:`, err.message)
    }
  }
  // Create translator with loaded locales
  translator = createTranslator(localesData, 'pt-BR')
}

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))

  // Polling adaptativo: foco = rápido, sem foco = médio, minimizado = lento.
  mainWindow.on('focus', () => socialApp && socialApp.setFocusState('focused'))
  mainWindow.on('blur', () => socialApp && socialApp.setFocusState('blurred'))
  mainWindow.on('minimize', () => socialApp && socialApp.setFocusState('background'))
  mainWindow.on('restore', () => socialApp && socialApp.setFocusState('focused'))
}

function registerIpcHandlers () {
  ipcMain.handle('identity:get', () => socialApp.getIdentity())

  ipcMain.handle('profile:get', () => socialApp.getProfile())

  ipcMain.handle('profile:setDisplayName', (_e, { displayName }) => socialApp.setDisplayName(displayName))

  ipcMain.handle('users:search', (_e, { query }) => socialApp.searchUsers(query))

  ipcMain.handle('post:create', (_e, { text, mediaPaths }) => socialApp.createPost({ text, mediaPaths }))

  ipcMain.handle('feed:get', () => socialApp.getFeed())

  ipcMain.handle('follow:list', () => socialApp.listFollows())

  ipcMain.handle('follow:add', (_e, { pubkeyHex, alias }) => socialApp.addFollow(pubkeyHex, alias))

  ipcMain.handle('follow:remove', (_e, { pubkeyHex }) => socialApp.removeFollow(pubkeyHex))

  ipcMain.handle('stats:get', () => socialApp.getStats())

  ipcMain.handle('dialog:pickImages', async () => {
    const imagesLabel = translator.t('dialog.imagesLabel', translator.getCurrentLang(), 'Imagens')
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: imagesLabel, extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
    })
    if (result.canceled) return []
    const fs = require('fs')
    const extToMime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
    return result.filePaths.map(p => {
      const ext = path.extname(p).toLowerCase()
      const mime = extToMime[ext] || 'application/octet-stream'
      const buf = fs.readFileSync(p)
      return { path: p, previewDataUrl: `data:${mime};base64,${buf.toString('base64')}` }
    })
  })

  ipcMain.handle('media:read', (_e, { pubkeyHex, isOwn, sha256, mime }) => {
    const filePath = socialApp.resolveMediaPath(pubkeyHex, isOwn, sha256)
    if (!filePath) return null
    const fs = require('fs')
    const buf = fs.readFileSync(filePath)
    return `data:${mime || 'application/octet-stream'};base64,${buf.toString('base64')}`
  })

  // i18n handlers
  ipcMain.handle('i18n:translate', (_e, { key, defaultValue }) => {
    return translator.t(key, translator.getCurrentLang(), defaultValue)
  })

  ipcMain.handle('i18n:setLang', async (_e, { lang }) => {
    translator.setCurrentLang(lang)
    // Persist language preference
    if (!socialApp.store.data.settings) {
      socialApp.store.data.settings = {}
    }
    socialApp.store.data.settings.language = lang
    await socialApp.store.save()
    return translator.getCurrentLang()
  })

  ipcMain.handle('i18n:getCurrentLang', () => {
    return translator.getCurrentLang()
  })

  ipcMain.handle('i18n:getAvailableLanguages', () => {
    return translator.getAvailableLanguages()
  })

  ipcMain.handle('i18n:pluralize', (_e, { count, keyPrefix }) => {
    return translator.pluralize(count, keyPrefix, translator.getCurrentLang())
  })

  ipcMain.handle('i18n:formatString', (_e, { template, values }) => {
    return translator.formatString(template, values)
  })

  ipcMain.handle('i18n:getLanguageLabel', (_e, { lang }) => {
    return translator.getLanguageLabel(lang)
  })

  // Backup handlers
  ipcMain.handle('backup:export', async (_e, { password }) => {
    try {
      const backup = require('../src/main/backup')
      const buffer = await backup.exportBackup(socialApp, password || null)
      // Converte Buffer para Uint8Array para enviar ao renderer
      return Array.from(buffer)
    } catch (err) {
      throw new Error(`Erro ao exportar backup: ${err.message}`)
    }
  })

  ipcMain.handle('backup:import', async (_e, { zipData, password }) => {
    try {
      const backup = require('../src/main/backup')
      const buffer = Buffer.from(zipData)
      const result = await backup.importBackup(socialApp, buffer, password || null)
      return result
    } catch (err) {
      return { ok: false, reason: `Erro ao importar backup: ${err.message}` }
    }
  })

  ipcMain.handle('backup:openFolder', async () => {
    try {
      const { shell } = require('electron')
      const paths = require('../src/main/paths')
      const backupsFolder = paths.backupsRoot()
      const fs = require('fs')
      fs.mkdirSync(backupsFolder, { recursive: true })
      shell.openPath(backupsFolder)
      return true
    } catch (err) {
      return false
    }
  })
}

app.whenReady().then(async () => {
  loadLocales()
  socialApp = new App(safeStorage)
  await socialApp.init()

  // Restore language preference
  const savedLang = socialApp.store.data.settings?.language || 'pt-BR'
  if (translator.getAvailableLanguages().includes(savedLang)) {
    translator.setCurrentLang(savedLang)
  }

  registerIpcHandlers()
  
  // Configure chapter manager event listeners to emit to renderer
  socialApp.chapters.on('post:added', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('chapter:post-added', data)
    }
  })
  socialApp.chapters.on('chapter:sealing', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('chapter:sealing', data)
    }
  })
  socialApp.chapters.on('chapter:saved', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('chapter:saved', data)
    }
  })
  socialApp.chapters.on('chapter:seeding', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('chapter:seeding', data)
    }
  })
  socialApp.chapters.on('chapter:seedingStarted', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('chapter:seeding-started', data)
    }
  })
  socialApp.chapters.on('chapter:rateLimited', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('chapter:rate-limited', data)
    }
  })
  
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async event => {
  if (socialApp && !socialApp._shuttingDown) {
    event.preventDefault()
    socialApp._shuttingDown = true
    await socialApp.shutdown()
    app.quit()
  }
})
