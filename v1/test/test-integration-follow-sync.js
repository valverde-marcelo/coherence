'use strict'

// Tests the full flow (follow + sync) between two nodes, using an isolated
// local DHT (hyperdht/testnet) — it doesn't depend on the real internet, but
// exercises the SAME code path (Hyperswarm + Corestore.replicate)
// that will be used in production.

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

  console.log('\n-> Bob follows Alice...')
  await bob.follow(alice.myPublicKeyHex)

  const synced = await waitUntil(async () => {
    const feed = await bob.getFeed()
    return feed.filter((p) => p.autor === alice.myPublicKeyHex).length === 2
  })

  const bobFeed = await bob.getFeed()
  console.log('Bob\'s feed after following Alice:')
  for (const p of bobFeed) console.log(' -', p.autor.slice(0, 8), p.tipo, JSON.stringify(p.texto))

  console.log('\nSynced Alice\'s 2 posts in time?', synced)

  const aliceProfileFromBob = await bob.getProfile(alice.myPublicKeyHex)
  console.log('Alice profile, seen by Bob:', aliceProfileFromBob)

  // Alice publishes a NEW post after Bob already followed her -> must arrive via 'append'
  await alice.publishPost({ tipo: 'texto', texto: 'Terceiro post, publicado depois do follow.' })
  const gotThird = await waitUntil(async () => {
    const feed = await bob.getFeed()
    return feed.some((p) => p.texto === 'Terceiro post, publicado depois do follow.')
  })
  console.log('Post published after the follow arrived in real time?', gotThird)

  // Verify that Alice registered Bob as a follower
  const aliceFollowers = await waitUntil(async () => {
    const followers = await alice.getFollowers()
    return followers.length === 1
  }, { timeout: 5000 })
  
  console.log('Alice registered Bob as a follower?', aliceFollowers)
  if (aliceFollowers) {
    const aliceFollowersList = await alice.getFollowers()
    console.log('Alice followers:', aliceFollowersList.map(f => f.publicKeyHex.slice(0, 12)))
  }

  const ok = synced && gotThird && bobFeed.length === 2 &&
    aliceProfileFromBob && aliceProfileFromBob.nome === 'Alice' &&
    aliceFollowers

  await alice.stop()
  await bob.stop()
  await testnet.destroy()

  console.log('\nRESULT:', ok ? 'PASS' : 'FAIL')
  process.exit(ok ? 0 : 1)
})().catch((err) => {
  console.error('TEST ERROR:', err)
  process.exit(1)
})
