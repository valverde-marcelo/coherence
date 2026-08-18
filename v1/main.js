'use strict'

const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { app, BrowserWindow, ipcMain, dialog, shell, net } = require('electron')
const { P2PNode } = require('./src/p2p-node')
const {
  publicKeyHexFromIdentity,
  readIdentity,
  userDataDir,
  listUserAccounts,
  writeAccountName,
  parseUserKeyArg,
  identityMatchesKey,
  migrateLegacyData,
  isEstablished
} = require('./src/user-data')
const {
  OFFICIAL_COHERENCE_KEY,
  SUGGESTED_USERS
} = require('./src/coherence-official')
const {
  extractCoherenceUrl,
  parseCoherenceUrl,
  startDeepLinkServer,
  registerInstance,
  findActiveInstance,
  sendDeepLinkTo
} = require('./src/deep-link')

let mainWindow = null
let node = null
let dataRoot = null
let dataDir = null
// True while the app is on the welcome screen (no account chosen yet). In
// this mode dataDir === dataRoot and the account selector is shown.
let welcomeMode = false
let statusUpdateInterval = null
let nodeLifecycle = Promise.resolve()
let quitting = false
let shuttingDown = false
// A coherence:// target waiting to be applied by the renderer.
let pendingDeepLink = null
// Loopback server that receives coherence:// URLs routed to this instance.
let deepLinkServer = null
// Removes this instance from the machine-wide deep-link registry.
let deepLinkUnregister = null
// True once the renderer subscribed to the 'deeplink' event.
let rendererDeepLinkReady = false

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

// =====================================================================
// Donations (PayPal + crypto)
// =====================================================================
// Replace the placeholders with the real PayPal link/hosted button and wallet
// addresses before release. The About tab renders whatever is configured here.
const DONATIONS = {
  // PayPal donate button (a paypal.me could not be created for this account;
  // the PayPal email is valverde.marcelo@gmail.com).
  paypalUrl: 'https://www.paypal.com/donate/?business=MX8LMBWFQY734&no_recurring=0&item_name=If+you+like+my+open-source+projects%2C+consider+buying+me+a+coffee+to+support+my+coding+journey%21&currency_code=USD',
  buyMeACoffeeUrl: 'https://buymeacoffee.com/valverdeoficial',
  crypto: [
    { coin: 'USDT (TRON)', address: 'THBH1uEjPjSXqA56PKzfUXTvZoLCQn5s8d' },
    // Bitcoin via Lightning Network invoice (QR scannable by LN wallets).
    // NOTE: lightning invoices expire — for a permanent donation QR prefer a
    // lightning address or a static-payment request.
    { coin: 'BTC (Lightning)', address: 'lnbc1p48l95rpp56pthy5lrtdzmqvqz22567kcnvq7cegmxmxce3pjfxekfv80ynsdsdquf35kw6r5de5kueeqd9h8vmmfvdjscqzpgxqyz5vqrzjqwghf7zxvfkxq5a6sr65g0gdkv768p83mhsnt0msszapamzx2qvuxqqqqpr3xsfgkqqqqqqqqqqqqqqq9qrzjq25carzepgd4vqsyn44jrk85ezrpju92xyrk9apw4cdjh6yrwt5jgqqqqpr3xsfgkqqqqqqqqqqqqqqq9qsp5q0xs92nyzeclyl95dakv8ghsdj6ksr2zg8w3rzlzxpczef4qd0ks9qxpqysgq2dm8u2xj405te8n3yuym2rjqwj7kc399nmzqh9cht80v44tp2k95vffd7pzecedn2ml4z4576ql8fykz2sgjrg9jxl2zsu7lh2kn9dgqny7g5w' }
  ]
}

// =====================================================================
// Update checking — GitHub Releases API (public, no hosted service)
// =====================================================================
const UPDATE_THROTTLE_MS = 24 * 60 * 60 * 1000 // max 1 check/day per user

function parseVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(version || '').trim())
  return match ? match.slice(1).map(Number) : null
}

function isNewerVersion(latest, current) {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}

async function fetchLatestRelease() {
  const response = await net.fetch(
    'https://api.github.com/repos/valverde-marcelo/coherence/releases/latest',
    {
      headers: {
        'User-Agent': 'coherence-app',
        Accept: 'application/vnd.github+json'
      }
    }
  )
  if (!response.ok) throw new Error('HTTP ' + response.status)
  const data = await response.json()
  return {
    latest: String(data.tag_name || '').replace(/^v/, ''),
    url: data.html_url || 'https://github.com/valverde-marcelo/coherence/releases/latest'
  }
}

async function checkForUpdates({ force = false } = {}) {
  const current = app.getVersion()
  try {
    const lastCheck = readSettings().lastUpdateCheck || 0
    if (!force && Date.now() - lastCheck < UPDATE_THROTTLE_MS) {
      return { available: false, current, throttled: true }
    }
    const { latest, url } = await fetchLatestRelease()
    writeSettings({ lastUpdateCheck: Date.now() })
    return { available: isNewerVersion(latest, current), current, latest, url }
  } catch (error) {
    return {
      available: false,
      current,
      error: error && error.message ? error.message : String(error)
    }
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

/**
 * Switches the main process out of "welcome" mode into an account. Sets the
 * account dataDir, reconfigures the per-account Electron paths and carries
 * the language chosen on the welcome screen into accounts that never set one.
 */
function enterAccountMode(dir) {
  welcomeMode = false
  dataDir = dir
  configureElectronDataPaths()
  try {
    let accountSettings = null
    try {
      accountSettings = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'))
    } catch {
      // Account has no settings yet — nothing to seed into.
    }
    if (accountSettings && !accountSettings.locale) {
      const welcomeSettings = JSON.parse(fs.readFileSync(path.join(dataRoot, 'settings.json'), 'utf8') || '{}')
      if (welcomeSettings.locale) writeSettings({ locale: welcomeSettings.locale })
    }
  } catch {
    // Best effort — the welcome locale is only a convenience.
  }
}

/**
 * Resolves which account the app will run, BEFORE the window is created.
 *
 *  - `--user-key <key>` (used by start.js/start-all.js for multi-instance):
 *    opens that specific account directly, skipping the welcome screen.
 *  - Any other launch (packaged .exe, plain `electron .`, `--new-user`):
 *    enters WELCOME MODE — the welcome screen always shows the account
 *    selector (even with 0 or 1 accounts), plus import/create options.
 */
function resolveDataDir() {
  migrateLegacyData(dataRoot)
  const requestedKey = parseUserKeyArg()
  if (requestedKey) {
    welcomeMode = false
    dataDir = userDataDir(dataRoot, requestedKey)
    const identity = readIdentity(path.join(dataDir, 'identity.json'))
    if (identity && !identityMatchesKey(identity, requestedKey)) {
      throw new Error('A identidade encontrada não corresponde à chave informada em --user-key.')
    }
    return
  }
  welcomeMode = true
  dataDir = dataRoot
}

function configureElectronDataPaths() {
  // The welcome screen (no account chosen yet) uses a fixed profile; every
  // account uses its own profile so concurrent instances never share the
  // session/cache directories in %TEMP%.
  const profileName = welcomeMode
    ? 'welcome'
    : path.basename(dataDir)
  const electronDataDir = path.join(os.tmpdir(), 'coherence-electron', profileName)
  app.setPath('userData', electronDataDir)
  app.setPath('sessionData', path.join(electronDataDir, 'session'))
}

async function startNode({ recovery = false } = {}) {
  const operation = nodeLifecycle.then(async () => {
    if (node) return node.myPublicKeyHex

    const startedNode = new P2PNode({ dataDir, autoFollowKey: OFFICIAL_COHERENCE_KEY })
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
  enterAccountMode(dataDir)
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(path.join(dataDir, 'identity.json'), JSON.stringify({
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' })
  }, null, 2))
  await startNode()
  if (username) {
    await node.updateMyProfile({ nome: String(username).trim() })
    // Cache the display name for the welcome account selector.
    writeAccountName(dataDir, String(username).trim())
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

/**
 * Hands a parsed coherence:// target to the renderer. If the renderer has not
 * subscribed to the 'deeplink' event yet (e.g. still on the welcome screen),
 * the target stays in `pendingDeepLink` and is delivered by app:renderer-ready
 * once the main app boots.
 */
function deliverDeepLink(target) {
  pendingDeepLink = target
  if (rendererDeepLinkReady && mainWindow && !mainWindow.isDestroyed()) {
    pendingDeepLink = null
    mainWindow.webContents.send('p2p:event:deeplink', target)
  }
}

/**
 * Starts the loopback deep-link server for this process and registers the
 * instance in the machine-wide registry, so other coherence:// dispatches can
 * route links to this window. Welcome-mode uses the 'welcome' account key.
 */
function startDeepLinkListener() {
  const accountKey = welcomeMode ? 'welcome' : path.basename(dataDir)
  startDeepLinkServer(accountKey, (url) => {
    const target = parseCoherenceUrl(url)
    if (target) deliverDeepLink(target)
  }).then((server) => {
    if (!server) return // another process owns this account's port — fine
    deepLinkServer = server
    deepLinkUnregister = registerInstance({ accountKey, port: server.port })
  }).catch((err) => {
    console.error('[deep-link] Could not start deep-link listener:', err)
  })
}

function registerIpcHandlers() {
  // Guards: during reset/quit the `node` can be null while the renderer still
  // makes calls (e.g. reacting to peers-changed from shutdown). They return
  // default values instead of throwing a TypeError in the main process.
  ipcMain.handle('p2p:get-my-key', () => node ? node.myPublicKeyHex : null)
  ipcMain.handle('p2p:get-profile', () => node ? node.getMyProfile() : null)
  ipcMain.handle('p2p:update-profile', async (_evt, patch) => {
    if (!node) return null
    const result = await node.updateMyProfile(patch)
    // Keep the cached display name (used by the welcome account selector) in
    // sync with the profile.
    if (patch && typeof patch.nome === 'string' && patch.nome.trim()) {
      writeAccountName(dataDir, patch.nome)
    }
    return result
  })
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
  // Hardcoded suggested users (sponsors/featured) shown at the top of the search screen.
  ipcMain.handle('p2p:get-suggested-users', () => SUGGESTED_USERS)
  ipcMain.handle('p2p:get-posts-of', (_evt, key) => node ? node.getPostsOf(key) : null)
  // Loads a user's core on demand (for coherence:// links to users you do not
  // follow yet). Returns true when the profile/posts are readable.
  ipcMain.handle('p2p:ensure-profile-loaded', (_evt, key) => node ? node.ensureProfileLoaded(key) : false)
  // Marks the renderer as ready to receive deep links and returns any link
  // that arrived before the main app booted (e.g. while on the welcome screen).
  ipcMain.handle('app:renderer-ready', () => {
    rendererDeepLinkReady = true
    const target = pendingDeepLink
    pendingDeepLink = null
    return target
  })
  ipcMain.handle('setup:get-settings', () => readSettings())
  ipcMain.handle('setup:set-settings', (_evt, settings) => writeSettings(settings))
  ipcMain.handle('setup:check-identity', () => fs.existsSync(path.join(dataDir, 'identity.json')))
  ipcMain.handle('setup:list-accounts', () => listUserAccounts(dataRoot))
  ipcMain.handle('setup:open-account', async (_evt, key) => {
    const normalized = String(key || '').toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error('Chave de conta inválida.')
    const dir = userDataDir(dataRoot, normalized)
    if (!fs.existsSync(path.join(dir, 'identity.json'))) {
      throw new Error('Conta não encontrada.')
    }
    enterAccountMode(dir)
    const publicKeyHex = await startNode({ recovery: !isEstablished(dataDir) })
    // Cache the display name so the welcome selector shows "Conta N - Nome".
    try {
      const profile = node && await node.getMyProfile()
      if (profile && profile.nome) writeAccountName(dataDir, profile.nome)
    } catch {
      // Best effort — the selector falls back to "Conta N".
    }
    return { publicKeyHex, state: node.lifecycleState }
  })
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
    enterAccountMode(dataDir)
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
  ipcMain.handle('get-donation-info', () => DONATIONS)
  ipcMain.handle('get-donation-qr', async (_evt, content) => {
    const QRCode = require('qrcode')
    const text = typeof content === 'string' && content
      ? content
      : 'https://github.com/valverde-marcelo/coherence'
    return QRCode.toDataURL(text, { width: 180, margin: 1 })
  })
  ipcMain.handle('check-for-updates', (_evt, opts) => checkForUpdates(opts || {}))
  ipcMain.handle('open-external', (_event, url) => {
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) throw new Error('URL externa inválida.')
    return shell.openExternal(url)
  })
}

async function main() {
  dataRoot = path.join(app.getPath('documents'), 'coherence-data')
  await app.whenReady()

  // Deep-link dispatch: if the OS launched us for a coherence:// URL and some
  // instance is already running, hand the link to it and quit. Otherwise keep
  // it as pending and apply it after an account is chosen.
  const initialUrl = extractCoherenceUrl(process.argv)
  if (initialUrl) {
    const parsed = parseCoherenceUrl(initialUrl)
    if (parsed) {
      const target = findActiveInstance()
      if (target && (await sendDeepLinkTo(target.port, initialUrl))) {
        app.quit()
        return
      }
      pendingDeepLink = parsed
    }
  }

  await resolveDataDir()
  if (dataDir == null) return
  configureElectronDataPaths()
  startDeepLinkListener()

  // Register coherence:// as the default protocol handler. In dev (npm start)
  // this points the scheme at the current Electron + app path; the packaged
  // installer already registers it via build.protocols in package.json.
  if (process.platform === 'win32' && !app.isPackaged) {
    try {
      // Dev apps MUST register with the app path, otherwise Windows would
      // launch electron.exe with only the URL (no app) and nothing would open.
      const args = process.defaultApp
        ? [path.resolve(process.argv[1])]
        : [path.resolve(app.getAppPath())]
      app.setAsDefaultProtocolClient('coherence', process.execPath, args)
    } catch (err) {
      console.error('[deep-link] Could not register coherence:// protocol:', err)
    }
  }

  registerIpcHandlers()
  // Auto-start only when an account was explicitly opened (--user-key /
  // multi-instance launchers). On the welcome screen the account is started
  // later, when the user picks it from the selector.
  if (
    !welcomeMode &&
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
  // Always release the deep-link server and registry entry, even on the early
  // exit path (welcome screen / dispatch without a node).
  if (deepLinkServer) {
    try { deepLinkServer.close() } catch { /* already closed */ }
    deepLinkServer = null
  }
  if (deepLinkUnregister) {
    try { deepLinkUnregister() } catch { /* best effort */ }
    deepLinkUnregister = null
  }
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
