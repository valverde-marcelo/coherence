'use strict'

const path = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')
const { P2PNode } = require('./src/p2p-node')

let mainWindow = null
let node = null

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
}

async function main() {
  // dataDir correto para um app instalado: pasta de dados do usuário do SO,
  // não o diretório relativo './' usado no protótipo original.
  node = new P2PNode({ dataDir: app.getPath('userData') })

  node.on('feed-updated', forward('p2p:event:feed-updated'))
  node.on('profile-updated', forward('p2p:event:profile-updated'))
  node.on('following-changed', forward('p2p:event:following-changed'))
  node.on('peers-changed', forward('p2p:event:peers-changed'))
  node.on('error', (err) => console.error('[P2PNode]', err))

  registerIpcHandlers()
  await node.start()
  console.log('Nó P2P pronto. Chave pública:', node.myPublicKeyHex)

  await app.whenReady()
  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Fecha o swarm e o Corestore com cuidado antes de sair, para não corromper
// o storage local.
app.on('before-quit', (event) => {
  if (!node) return
  event.preventDefault()
  const toClose = node
  node = null
  toClose.stop().finally(() => app.exit(0))
})

main().catch((err) => {
  console.error('Falha ao iniciar o app:', err)
  app.quit()
})
