'use strict'

const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const { P2PNode } = require('./src/p2p-node')
const {
  publicKeyHexFromIdentity,
  readIdentity,
  userDataDir,
  listUserKeys,
  parseUserKeyArg,
  identityMatchesKey,
  migrateLegacyData,
  isEstablished
} = require('./src/user-data')

let mainWindow = null
let node = null
let dataRoot = null
let dataDir = null
let statusUpdateInterval = null
let nodeLifecycle = Promise.resolve()
let quitting = false
let shuttingDown = false

// =====================================================================
// Protection against "EPIPE: broken pipe" when logging
// =====================================================================
// When the app is launched by start-all (or runs in a terminal that gets
// closed), stdout/stderr can become a broken pipe. In that case, a
// console.log() throws EPIPE as an UNCAUGHT exception in the main process —
// and Electron opens an "Error" popup. Here we ensure console.log/error never
// throws: write errors are silently ignored.
for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
  const original = console[method].bind(console)
  console[method] = (...args) => {
    try {
      original(...args)
    } catch (err) {
      if (err && (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED')) {
        // Output unavailable — nothing to do besides not breaking the app.
      } else {
        // Not a pipe problem: rethrow to avoid hiding real errors.
        try { original(err) } catch { /* ignore */ }
      }
    }
  }
}
// The stream can also emit 'error' (e.g. EPIPE) — without a listener this
// would become an uncaught exception. We ignore it silently.
for (const stream of [process.stdout, process.stderr]) {
  if (stream && typeof stream.on === 'function') {
    stream.on('error', () => { /* output unavailable — ignore */ })
  }
}

function settingsFile() {
  return path.join(dataDir, 'settings.json')
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))
  } catch {
    return { locale: 'pt-BR' }
  }
}

function writeSettings(settings = {}) {
  const locale = settings.locale === 'en-US' ? 'en-US' : 'pt-BR'
  const value = { ...readSettings(), ...settings, locale }
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(settingsFile(), JSON.stringify(value, null, 2))
  return value
}

function validateIdentity(identity) {
  if (!identity || typeof identity.publicKey !== 'string' || typeof identity.privateKey !== 'string') {
    throw new Error('O arquivo precisa conter publicKey e privateKey em formato PEM.')
  }
  try {
    require('node:crypto').createPublicKey(identity.publicKey)
    require('node:crypto').createPrivateKey(identity.privateKey)
  } catch {
    throw new Error('As chaves do arquivo identity.json não são PEM válidos.')
  }
}

function setDataDirFromIdentity(identity) {
  dataDir = userDataDir(dataRoot, publicKeyHexFromIdentity(identity))
  fs.mkdirSync(dataDir, { recursive: true })
  return dataDir
}

function isNewUserRequested() {
  return process.argv.includes('--new-user') ||
    app.commandLine.hasSwitch('new-user') ||
    process.env.npm_config_new_user === 'true' ||
    process.env.npm_config_new_user === '1'
}

function resolveDataDir() {
  migrateLegacyData(dataRoot)
  const requestedKey = parseUserKeyArg()
  const newUserRequested = isNewUserRequested()
  const keys = listUserKeys(dataRoot)
  if (newUserRequested && !requestedKey) {
    dataDir = dataRoot
  } else if (requestedKey) {
    dataDir = userDataDir(dataRoot, requestedKey)
    const identity = readIdentity(path.join(dataDir, 'identity.json'))
    if (identity && !identityMatchesKey(identity, requestedKey)) {
      throw new Error('A identidade encontrada não corresponde à chave informada em --user-key.')
    }
  } else if (keys.length === 1) {
    dataDir = userDataDir(dataRoot, keys[0])
  } else if (keys.length > 1 && !newUserRequested) {
    throw new Error('Há mais de um usuário local. Inicie com --user-key <chave-publica> ou --new-user.')
  } else {
    dataDir = dataRoot
  }
}

function configureElectronDataPaths() {
  const profileName = isNewUserRequested() && dataDir === dataRoot
    ? path.join('new-user', String(process.pid))
    : path.basename(dataDir)
  const electronDataDir = path.join(os.tmpdir(), 'coherence-electron', profileName)
  app.setPath('userData', electronDataDir)
  app.setPath('sessionData', path.join(electronDataDir, 'session'))
}

async function startNode({ recovery = false } = {}) {
  const operation = nodeLifecycle.then(async () => {
    if (node) return node.myPublicKeyHex

    const startedNode = new P2PNode({ dataDir })
    node = startedNode
    shuttingDown = false
    console.log('Starting P2P node with storage at', startedNode.dataDir)
    startedNode.on('feed-updated', forward('p2p:event:feed-updated'))
    startedNode.on('profile-updated', forward('p2p:event:profile-updated'))
    startedNode.on('following-changed', forward('p2p:event:following-changed'))
    startedNode.on('peers-changed', forward('p2p:event:peers-changed'))
    startedNode.on('recovery-updated', forward('p2p:event:recovery-updated'))
    startedNode.on('error', (err) => console.error('[P2PNode]', err))
    try {
      await startedNode.start({ recovery })
    } catch (error) {
      if (node === startedNode) node = null
      await startedNode.stop().catch(() => {})
      throw error
    }
    console.log(
      startedNode.lifecycleState === 'recovery'
        ? 'P2P node waiting for recovery. Public key:'
        : 'P2P node ready. Public key:',
      startedNode.myPublicKeyHex
    )
    statusUpdateInterval = setInterval(async () => {
      if (node !== startedNode || startedNode.lifecycleState !== 'ready') return
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          const followingList = await startedNode.getFollowingList()
          if (node === startedNode && startedNode.lifecycleState === 'ready') {
            mainWindow.webContents.send('p2p:event:following-status-update', followingList)
          }
        } catch (err) {
          if (node === startedNode && startedNode.lifecycleState === 'ready') {
            console.error('[Status Update Polling]', err)
          }
        }
      }
    }, 7000)
    return startedNode.myPublicKeyHex
  })
  nodeLifecycle = operation.catch(() => {})
  return operation
}

function stopNode() {
  const operation = nodeLifecycle.then(async () => {
    // Marks the shutdown: forward() stops relaying events to the renderer and
    // the IPC handlers return default values while `node` is null.
    shuttingDown = true
    if (statusUpdateInterval) {
      clearInterval(statusUpdateInterval)
      statusUpdateInterval = null
    }

    const toClose = node
    node = null
    if (toClose) await toClose.stop()
  })
  nodeLifecycle = operation.catch(() => {})
  return operation
}

/**
 * Removes a user's folder whose identity was imported but NEVER recovered
 * (cancel/close during recovery, or "start from scratch"). It contains only
 * the copied identity.json + partial/temporary corestore + settings. Never
 * removes the root (dataRoot), so other local users are not deleted.
 */
function removePendingImport() {
  if (!dataDir || dataDir === dataRoot) return
  try {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 })
    console.log('[removePendingImport] Pending import removed:', dataDir)
  } catch (error) {
    console.error('[removePendingImport]', error)
  }
}

/**
 * Generates a NEW identity (Ed25519 keypair), writes it in its own directory and
 * starts the node. Used both for "create user" (with a name) and for "start from
 * scratch" (without a name), which now DISCARDS the unrecovered imported identity.
 */
async function createNewUserIdentity(username) {
  const crypto = require('node:crypto')
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  setDataDirFromIdentity({ publicKey: publicKey.export({ type: 'spki', format: 'pem' }) })
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(path.join(dataDir, 'identity.json'), JSON.stringify({
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' })
  }, null, 2))
  await startNode()
  if (username) {
    await node.updateMyProfile({ nome: String(username).trim() })
  }
  return { publicKeyHex: node.myPublicKeyHex }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1140,
    height: 780,
    minWidth: 760,
    minHeight: 540,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
}

// Forwards P2PNode events to the window, such as feed/profile updates.
function forward(channel) {
  return (...args) => {
    // During shutdown (reset/quit) do not relay events: the renderer is still
    // alive and would react by calling IPC handlers with `node` already null.
    if (!shuttingDown && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, ...args)
    }
  }
}

function registerIpcHandlers() {
  // Guards: during reset/quit the `node` can be null while the renderer still
  // makes calls (e.g. reacting to peers-changed from shutdown). They return
  // default values instead of throwing a TypeError in the main process.
  ipcMain.handle('p2p:get-my-key', () => node ? node.myPublicKeyHex : null)
  ipcMain.handle('p2p:get-profile', () => node ? node.getMyProfile() : null)
  ipcMain.handle('p2p:update-profile', (_evt, patch) => node ? node.updateMyProfile(patch) : null)
  ipcMain.handle('p2p:publish-post', (_evt, post) => node ? node.publishPost(post) : null)
  ipcMain.handle('p2p:follow', (_evt, key) => node ? node.follow(key) : null)
  ipcMain.handle('p2p:unfollow', (_evt, key) => node ? node.unfollow(key) : null)
  ipcMain.handle('p2p:get-profile-of', (_evt, key) => node ? node.getProfile(key) : null)
  ipcMain.handle('p2p:get-following', () => node ? node.getFollowingList() : null)
  ipcMain.handle('p2p:get-feed', (_evt, opts) => node ? node.getFeed(opts) : null)
  ipcMain.handle('p2p:get-peer-count', () => node && node.swarm ? node.swarm.connections.size : 0)
  ipcMain.handle('p2p:get-followers', () => node ? node.getFollowers() : [])
  ipcMain.handle('p2p:get-user-social', (_evt, key) => node ? node.getUserSocial(key) : null)
  ipcMain.handle('p2p:search-users', (_evt, query, opts) => node ? node.searchUsers(query, opts) : [])
  ipcMain.handle('p2p:get-posts-of', (_evt, key) => node ? node.getPostsOf(key) : null)
  ipcMain.handle('setup:get-settings', () => readSettings())
  ipcMain.handle('setup:set-settings', (_evt, settings) => writeSettings(settings))
  ipcMain.handle('setup:check-identity', () => fs.existsSync(path.join(dataDir, 'identity.json')))
  ipcMain.handle('setup:import-identity', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Importar identidade',
      properties: ['openFile'],
      filters: [{ name: 'Identity JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    const sourcePath = result.filePaths[0]
    const identity = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))
    validateIdentity(identity)
    setDataDirFromIdentity(identity)
    fs.mkdirSync(dataDir, { recursive: true })
    fs.copyFileSync(sourcePath, path.join(dataDir, 'identity.json'))
    return { canceled: false, publicKeyHex: await startNode({ recovery: true }), state: node.lifecycleState }
  })
  ipcMain.handle('setup:create-identity', async (_evt, username) => {
    if (!/^[\p{L}\p{N} _.-]{1,30}$/u.test(String(username || '').trim())) {
      throw new Error('O nome deve ter de 1 a 30 caracteres e não pode conter @ ou #.')
    }
    return createNewUserIdentity(username)
  })
  ipcMain.handle('setup:start-app', async () => {
    const hasIdentity = fs.existsSync(path.join(dataDir, 'identity.json'))
    const publicKeyHex = await startNode({
      // Only enters recovery if there are NO established local data.
      // A user with a sound local corestore starts directly — even if the
      // recovered.json marker was lost (e.g. sync conflict).
      recovery: hasIdentity && !isEstablished(dataDir)
    })
    return { publicKeyHex, state: node.lifecycleState }
  })
  ipcMain.handle('setup:get-state', () => node ? node.lifecycleState : 'stopped')
  ipcMain.handle('setup:get-recovery-status', () => {
    if (!node || node.lifecycleState !== 'recovery') {
      return { state: node ? node.lifecycleState : 'stopped', peerCount: 0, corePeers: 0 }
    }
    return {
      state: node.lifecycleState,
      peerCount: node.swarm ? node.swarm.connections.size : 0,
      corePeers: node.myCore ? node.myCore.peers.length : 0
    }
  })
  ipcMain.handle('setup:start-from-zero', async () => {
    await stopNode()
    // Discards the unrecovered imported identity: drops the pending folder
    // and generates a NEW identity (never reuses the imported key).
    removePendingImport()
    const publicKeyHex = await createNewUserIdentity()
    return { publicKeyHex, state: node.lifecycleState }
  })
  ipcMain.handle('setup:cancel-recovery', async () => {
    const wasRecovery = node && node.lifecycleState === 'recovery'
    await stopNode()
    // Only removes the folder if the imported identity was NEVER recovered; if
    // recovery had already completed (state 'ready'), the data is preserved.
    if (wasRecovery) removePendingImport()
    app.quit()
    return { success: true }
  })
  ipcMain.handle('export-identity', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Exportar identidade',
      defaultPath: 'identity.json',
      filters: [{ name: 'Identity JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return { success: false, canceled: true }
    fs.copyFileSync(path.join(dataDir, 'identity.json'), result.filePath)
    return { success: true }
  })
  ipcMain.handle('reset-app', async () => {
    try {
      await stopNode()
      fs.rmSync(dataDir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 250
      })
      app.relaunch()
      app.exit(0)
      return { success: true }
    } catch (error) {
      console.error('[Reset]', error)
      return { success: false }
    }
  })
  ipcMain.handle('get-app-version', () => app.getVersion())
  ipcMain.handle('get-donation-qr', async () => {
    const QRCode = require('qrcode')
    return QRCode.toDataURL('https://github.com/valverde-marcelo/coherence', { width: 180, margin: 1 })
  })
  ipcMain.handle('open-external', (_event, url) => {
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) throw new Error('URL externa inválida.')
    return shell.openExternal(url)
  })
}

async function main() {
  dataRoot = path.join(app.getPath('documents'), 'coherence-data')
  resolveDataDir()
  configureElectronDataPaths()

  registerIpcHandlers()
  await app.whenReady()
  if (
    fs.existsSync(path.join(dataDir, 'identity.json')) &&
    isEstablished(dataDir)
  ) {
    await startNode()
  }
  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // Clear the polling when closing
  mainWindow.on('closed', () => {
    clearInterval(statusUpdateInterval)
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Closes the swarm and Corestore carefully before exiting, to avoid corrupting
// the local storage.
app.on('before-quit', (event) => {
  if (quitting || (!node && !statusUpdateInterval)) return
  event.preventDefault()
  quitting = true
  const wasRecovery = node && node.lifecycleState === 'recovery'
  stopNode().finally(() => {
    if (wasRecovery) removePendingImport()
    app.exit(0)
  })
})

main().catch((err) => {
  console.error('Failed to start the app:', err)
  app.quit()
})
