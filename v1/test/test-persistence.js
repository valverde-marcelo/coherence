'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const createTestnet = require('hyperdht/testnet')
const { P2PNode } = require('../src/p2p-node')

function tmpDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name + '-'))
}

async function waitUntil(check, timeout = 10000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeout) {
    if (await check()) return true
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return false
}

;(async () => {
  const testnet = await createTestnet(2)
  const dataDir = tmpDir('restart-test')

  // "sessão 1": cria identidade, publica post, segue alguém
  const friend = new P2PNode({ dataDir: tmpDir('friend'), swarmOpts: { dht: testnet.createNode() } })
  await friend.start()
  await friend.publishPost({ tipo: 'texto', texto: 'oi' })

  let node = new P2PNode({ dataDir, swarmOpts: { dht: testnet.createNode() } })
  await node.start()
  const originalPublicKey = node.myPublicKeyHex
  await node.updateMyProfile({ nome: 'Persistente' })
  await node.publishPost({ tipo: 'texto', texto: 'este post precisa sobreviver a um reinício' })
  await node.follow(friend.myPublicKeyHex)
  await waitUntil(async () => {
    const list = await node.getFollowingList()
    return list.some((peer) => peer.publicKeyHex === friend.myPublicKeyHex && peer.nome)
  })
  await node.stop()

  // "sessão 2": processo reaberto, mesmo dataDir
  node = new P2PNode({ dataDir, swarmOpts: { dht: testnet.createNode() } })
  await node.start()

  const sameKey = node.myPublicKeyHex === originalPublicKey
  const profile = await node.getMyProfile()
  const feed = await node.getFeed()
  const following = (await node.getMyProfile()).followList
  const followingProfiles = await node.getFollowingList()

  console.log('Chave pública igual após reiniciar?', sameKey)
  console.log('Nome do perfil preservado?', profile.nome === 'Persistente')
  console.log('Post próprio preservado?', feed.some((p) => p.texto === 'este post precisa sobreviver a um reinício'))
  console.log('Lista de quem segue preservada?', following.includes(friend.myPublicKeyHex))
  console.log('Perfil de quem segue resolvido após reinício?', followingProfiles.some((p) =>
    p.publicKeyHex === friend.myPublicKeyHex && p.nome
  ))

  const ok = sameKey && profile.nome === 'Persistente' &&
    feed.some((p) => p.texto === 'este post precisa sobreviver a um reinício') &&
    following.includes(friend.myPublicKeyHex) &&
    followingProfiles.some((p) => p.publicKeyHex === friend.myPublicKeyHex && p.nome)

  await node.stop()
  await friend.stop()
  await testnet.destroy()

  console.log('\nRESULTADO:', ok ? 'PASSOU' : 'FALHOU')
  process.exit(ok ? 0 : 1)
})().catch((err) => {
  console.error('ERRO NO TESTE:', err)
  process.exit(1)
})
