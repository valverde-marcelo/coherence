'use strict'

// Testa o requisito de "semeadura": Bob segue Alice e fica com os posts
// dela em cache. Alice fica OFFLINE. Carol passa a seguir Alice mesmo assim
// — like ela não consegue falar com a Alice diretamente, mas Bob (que
// também está anunciado no tópico da Alice, como {server:true}) serve os
// dados em nome dela.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const createTestnet = require('hyperdht/testnet')
const { P2PNode } = require('../src/p2p-node')

function tmpDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name + '-'))
}

async function waitUntil(check, { timeout = 10000, interval = 150 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await check()) return true
    await new Promise((r) => setTimeout(r, interval))
  }
  return false
}

;(async () => {
  const testnet = await createTestnet(4)

  const alice = new P2PNode({ dataDir: tmpDir('alice'), swarmOpts: { dht: testnet.createNode() } })
  const bob = new P2PNode({ dataDir: tmpDir('bob'), swarmOpts: { dht: testnet.createNode() } })
  const carol = new P2PNode({ dataDir: tmpDir('carol'), swarmOpts: { dht: testnet.createNode() } })

  await alice.start()
  await bob.start()
  await carol.start()

  await alice.updateMyProfile({ nome: 'Alice' })
  await alice.publishPost({ tipo: 'texto', texto: 'Post 1 da Alice' })
  await alice.publishPost({ tipo: 'texto', texto: 'Post 2 da Alice' })

  console.log('-> Bob segue Alice (vai cachear e semear o perfil dela)...')
  await bob.follow(alice.myPublicKeyHex)
  const bobSynced = await waitUntil(async () => (await bob.getFeed()).length === 2)
  console.log('Bob sincronizou os posts da Alice?', bobSynced)

  console.log('-> Alice fica offline...')
  await alice.stop()
  await new Promise((r) => setTimeout(r, 500))

  console.log('-> Carol passa a seguir Alice, com a Alice JÁ offline...')
  await carol.follow(alice.myPublicKeyHex)

  const carolGotSeededData = await waitUntil(async () => {
    const feed = await carol.getFeed()
    return feed.filter((p) => p.autor === alice.myPublicKeyHex).length === 2
  })

  const carolFeed = await carol.getFeed()
  console.log('Feed da Carol (Alice offline, dados vindos do Bob como semeador):')
  for (const p of carolFeed) console.log(' -', p.autor.slice(0, 8), JSON.stringify(p.texto))

  const carolProfile = await carol.getProfile(alice.myPublicKeyHex)
  console.log('Perfil da Alice, visto pela Carol (via Bob):', carolProfile)

  const ok = bobSynced && carolGotSeededData && carolProfile && carolProfile.nome === 'Alice'

  await bob.stop()
  await carol.stop()
  await testnet.destroy()

  console.log('\nRESULTADO:', ok ? 'PASSOU (semeadura funcionou com a dona do perfil offline)' : 'FALHOU')
  process.exit(ok ? 0 : 1)
})().catch((err) => {
  console.error('ERRO NO TESTE:', err)
  process.exit(1)
})
