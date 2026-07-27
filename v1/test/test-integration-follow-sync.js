'use strict'

// Testa o fluxo completo (seguir + sincronizar) entre dois nós, usando uma
// DHT local isolada (hyperdht/testnet) — não depende da internet real, mas
// exercita o MESMO caminho de código (Hyperswarm + Corestore.replicate)
// que será usado em produção.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const createTestnet = require('hyperdht/testnet')
const { P2PNode } = require('../src/p2p-node')

function tmpDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name + '-'))
}

async function waitUntil(check, { timeout = 8000, interval = 100 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await check()) return true
    await new Promise((r) => setTimeout(r, interval))
  }
  return false
}

;(async () => {
  const testnet = await createTestnet(3)

  const alice = new P2PNode({ dataDir: tmpDir('alice'), swarmOpts: { dht: testnet.createNode() } })
  const bob = new P2PNode({ dataDir: tmpDir('bob'), swarmOpts: { dht: testnet.createNode() } })

  await alice.start()
  await bob.start()

  console.log('Alice publicKeyHex:', alice.myPublicKeyHex)
  console.log('Bob   publicKeyHex:', bob.myPublicKeyHex)

  await alice.updateMyProfile({ nome: 'Alice', bio: 'Primeiro nó de teste' })
  await alice.publishPost({ tipo: 'texto', texto: 'Meu primeiro post na rede!' })
  await alice.publishPost({ tipo: 'texto', texto: 'Segundo post, ainda sem seguidores.' })

  console.log('\n-> Bob segue Alice...')
  await bob.follow(alice.myPublicKeyHex)

  const synced = await waitUntil(async () => {
    const feed = await bob.getFeed()
    return feed.filter((p) => p.autor === alice.myPublicKeyHex).length === 2
  })

  const bobFeed = await bob.getFeed()
  console.log('Feed do Bob após seguir Alice:')
  for (const p of bobFeed) console.log(' -', p.autor.slice(0, 8), p.tipo, JSON.stringify(p.texto))

  console.log('\nSincronizou os 2 posts da Alice a tempo?', synced)

  const aliceProfileFromBob = await bob.getProfile(alice.myPublicKeyHex)
  console.log('Perfil da Alice, visto pelo Bob:', aliceProfileFromBob)

  // Alice publica um post NOVO depois que Bob já a seguia -> deve chegar via 'append'
  await alice.publishPost({ tipo: 'texto', texto: 'Terceiro post, publicado depois do follow.' })
  const gotThird = await waitUntil(async () => {
    const feed = await bob.getFeed()
    return feed.some((p) => p.texto === 'Terceiro post, publicado depois do follow.')
  })
  console.log('Post publicado após o follow chegou em tempo real?', gotThird)

  const ok = synced && gotThird && bobFeed.length === 2 &&
    aliceProfileFromBob && aliceProfileFromBob.nome === 'Alice'

  await alice.stop()
  await bob.stop()
  await testnet.destroy()

  console.log('\nRESULTADO:', ok ? 'PASSOU' : 'FALHOU')
  process.exit(ok ? 0 : 1)
})().catch((err) => {
  console.error('ERRO NO TESTE:', err)
  process.exit(1)
})
