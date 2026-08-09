'use strict'

const path = require('node:path')
const fs = require('node:fs')
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const { P2PNode } = require('./src/p2p-node')

let mainWindow = null
let node = null
let dataDir = null
let statusUpdateInterval = null
let nodeLifecycle = Promise.resolve()
let quitting = false

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

async function startNode({ recovery = false } = {}) {
  const operation = nodeLifecycle.then(async () => {
    if (node) return node.myPublicKeyHex

    const startedNode = new P2PNode({ dataDir })
    node = startedNode
    console.log('Iniciando nó P2P com storage em', startedNode.dataDir)
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
    console.log('Nó P2P pronto. Chave pública:', startedNode.myPublicKeyHex)
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

// Encaminha eventos do P2PNode para a janela, como updates de feed/perfil.
function forward(channel) {
  return (...args) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, ...args)
    }
  }
}

function registerIpcHandlers() {
  ipcMain.handle('p2p:get-my-key', () => node.myPublicKeyHex)
  ipcMain.handle('p2p:get-profile', () => node.getMyProfile())
  ipcMain.handle('p2p:update-profile', (_evt, patch) => node.updateMyProfile(patch))
  ipcMain.handle('p2p:publish-post', (_evt, post) => node.publishPost(post))
  ipcMain.handle('p2p:follow', (_evt, key) => node.follow(key))
  ipcMain.handle('p2p:unfollow', (_evt, key) => node.unfollow(key))
  ipcMain.handle('p2p:get-profile-of', (_evt, key) => node.getProfile(key))
  ipcMain.handle('p2p:get-following', () => node.getFollowingList())
  ipcMain.handle('p2p:get-feed', (_evt, opts) => node.getFeed(opts))
  ipcMain.handle('p2p:get-peer-count', () => node.swarm.connections.size)
  ipcMain.handle('p2p:get-followers', () => node.getFollowers())
  ipcMain.handle('p2p:get-posts-of', (_evt, key) => node.getPostsOf(key))
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
    fs.mkdirSync(dataDir, { recursive: true })
    fs.copyFileSync(sourcePath, path.join(dataDir, 'identity.json'))
    return { canceled: false, publicKeyHex: await startNode({ recovery: true }), state: node.lifecycleState }
  })
  ipcMain.handle('setup:create-identity', async (_evt, username) => {
    if (!/^[\p{L}\p{N} _.-]{1,30}$/u.test(String(username || '').trim())) {
      throw new Error('O nome deve ter de 1 a 30 caracteres e não pode conter @ ou #.')
    }
    const crypto = require('node:crypto')
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'identity.json'), JSON.stringify({
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' })
    }, null, 2))
    await startNode()
    await node.updateMyProfile({ nome: String(username).trim() })
    return { publicKeyHex: node.myPublicKeyHex }
  })
  ipcMain.handle('setup:start-app', async () => {
    const publicKeyHex = await startNode({
      recovery: fs.existsSync(path.join(dataDir, 'identity.json')) &&
        !fs.existsSync(path.join(dataDir, 'corestore'))
    })
    return { publicKeyHex, state: node.lifecycleState }
  })
  ipcMain.handle('setup:start-from-zero', async () => {
    await stopNode()
    fs.rmSync(path.join(dataDir, 'corestore'), { recursive: true, force: true })
    const publicKeyHex = await startNode()
    return { publicKeyHex, state: node.lifecycleState }
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
      fs.rmSync(dataDir, { recursive: true, force: true })
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
  dataDir = path.join(app.getPath('documents'), 'coherence-data')

  registerIpcHandlers()
  await app.whenReady()
  if (fs.existsSync(path.join(dataDir, 'identity.json')) && fs.existsSync(path.join(dataDir, 'corestore'))) {
    await startNode()
  }
  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // Limpar polling ao fechar
  mainWindow.on('closed', () => {
    clearInterval(statusUpdateInterval)
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Fecha o swarm e o Corestore com cuidado antes de sair, para não corromper
// o storage local.
app.on('before-quit', (event) => {
  if (quitting || (!node && !statusUpdateInterval)) return
  event.preventDefault()
  quitting = true
  stopNode().finally(() => app.exit(0))
})

main().catch((err) => {
  console.error('Falha ao iniciar o app:', err)
  app.quit()
})
