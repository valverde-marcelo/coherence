'use strict'

// Tests the "seeding" requirement: Bob follows Alice and caches her posts.
// Alice goes OFFLINE. Carol still follows Alice — even though she can't talk
// to Alice directly, Bob (who is also announced on Alice's topic, as
// {server:true}) serves the data on her behalf.

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

  console.log('-> Bob follows Alice (will cache and seed her profile)...')
  await bob.follow(alice.myPublicKeyHex)
  const bobSynced = await waitUntil(async () => (await bob.getFeed()).length === 2)
  console.log('Bob synced Alice\'s posts?', bobSynced)

  console.log('-> Alice goes offline...')
  await alice.stop()
  await new Promise((r) => setTimeout(r, 500))

  console.log('-> Carol now follows Alice, with Alice ALREADY offline...')
  await carol.follow(alice.myPublicKeyHex)

  const carolGotSeededData = await waitUntil(async () => {
    const feed = await carol.getFeed()
    return feed.filter((p) => p.autor === alice.myPublicKeyHex).length === 2
  })

  const carolFeed = await carol.getFeed()
  console.log('Carol\'s feed (Alice offline, data coming from Bob as seeder):')
  for (const p of carolFeed) console.log(' -', p.autor.slice(0, 8), JSON.stringify(p.texto))

  const carolProfile = await carol.getProfile(alice.myPublicKeyHex)
  console.log('Alice profile, seen by Carol (via Bob):', carolProfile)

  const ok = bobSynced && carolGotSeededData && carolProfile && carolProfile.nome === 'Alice'

  await bob.stop()
  await carol.stop()
  await testnet.destroy()

  console.log('\nRESULT:', ok ? 'PASS (seeding worked with the profile owner offline)' : 'FAIL')
  process.exit(ok ? 0 : 1)
})().catch((err) => {
  console.error('TEST ERROR:', err)
  process.exit(1)
})
