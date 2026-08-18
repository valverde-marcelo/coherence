'use strict'

// =====================================================================
// Reproduces: posts missing on a profile page even when the entry EXISTS
// (followed / followerDataCache).
//
// Scenario A: Bob follows Alice (explicitly). Alice posts BEFORE and AFTER
//   the follow. Bob visits Alice's profile -> getPostsOf(Alice) must show
//   Alice's posts.
//
// Scenario B: Official is followed by Alice and Bob (auto-follow). Alice
//   publishes posts. Official visits Alice's profile -> getPostsOf(Alice)
//   must show Alice's posts (Alice is in Official's followerDataCache).
//
// Usage: node test/test-profile-posts-followed.js
// =====================================================================

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const createTestnet = require('hyperdht/testnet')
const { P2PNode } = require('../src/p2p-node')

function tmpDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name + '-'))
}

async function waitUntil(check, { timeout = 25000, interval = 250 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await check()) return true
    await new Promise((r) => setTimeout(r, interval))
  }
  return false
}

;(async () => {
  const testnet = await createTestnet(4)

  // ------------------------------------------------------------------
  // SCENARIO A: Bob follows Alice
  // ------------------------------------------------------------------
  const alice = new P2PNode({ dataDir: tmpDir('pf-alice'), swarmOpts: { dht: testnet.createNode() } })
  const bob = new P2PNode({ dataDir: tmpDir('pf-bob'), swarmOpts: { dht: testnet.createNode() } })

  await alice.start()
  await bob.start()
  await alice.updateMyProfile({ nome: 'Alice' })
  await bob.updateMyProfile({ nome: 'Bob' })

  // Alice posts BEFORE Bob follows her
  await alice.publishPost({ tipo: 'texto', texto: 'post-alice-1' })

  // Bob follows Alice
  await bob.follow(alice.myPublicKeyHex)

  // Alice posts AFTER the follow (newer block that must re-sync to Bob)
  await alice.publishPost({ tipo: 'texto', texto: 'post-alice-2' })

  // Bob visits Alice's profile repeatedly until he sees both posts
  const aPosts = await waitUntil(async () => {
    const posts = await bob.getPostsOf(alice.myPublicKeyHex)
    return posts.some((p) => p.texto === 'post-alice-1') && posts.some((p) => p.texto === 'post-alice-2')
  })
  const bobSeesAlicePosts = await bob.getPostsOf(alice.myPublicKeyHex)
  console.log('SCENARIO A — Bob sees BOTH Alice posts?', aPosts)
  console.log('  bob.getPostsOf(Alice) →', (bobSeesAlicePosts || []).map((p) => p.texto))

  await alice.stop().catch(() => {})
  await bob.stop().catch(() => {})

  // ------------------------------------------------------------------
  // SCENARIO B: Official is followed by Alice and Bob
  // ------------------------------------------------------------------
  const official = new P2PNode({ dataDir: tmpDir('pf-official'), swarmOpts: { dht: testnet.createNode() } })
  await official.start()
  await official.updateMyProfile({ nome: 'Oficial' })
  const officialKey = official.myPublicKeyHex

  const alice2 = new P2PNode({ dataDir: tmpDir('pf-alice2'), swarmOpts: { dht: testnet.createNode() }, autoFollowKey: officialKey })
  const bob2 = new P2PNode({ dataDir: tmpDir('pf-bob2'), swarmOpts: { dht: testnet.createNode() }, autoFollowKey: officialKey })

  await alice2.start()
  await bob2.start()
  await alice2.updateMyProfile({ nome: 'Alice2' })
  await bob2.updateMyProfile({ nome: 'Bob2' })

  // Alice2 and Bob2 should have auto-followed the official
  const autoFollowed = await waitUntil(async () => {
    const al = await alice2.getFollowingList()
    const bo = await bob2.getFollowingList()
    return al.some((p) => p.publicKeyHex === officialKey) && bo.some((p) => p.publicKeyHex === officialKey)
  })
  console.log('SCENARIO B — Alice2/Bob2 auto-followed Official?', autoFollowed)

  // Alice2 publishes posts
  await alice2.publishPost({ tipo: 'texto', texto: 'post-alice2-1' })
  await alice2.publishPost({ tipo: 'texto', texto: 'post-alice2-2' })

  // Wait for the Official to register Alice2 as a follower
  const officialHasFollower = await waitUntil(async () => {
    const followers = await official.getFollowers()
    return followers.some((f) => f.publicKeyHex === alice2.myPublicKeyHex)
  })
  console.log('SCENARIO B — Official registered Alice2 as follower?', officialHasFollower)

  // Official visits Alice2's profile -> getPostsOf(Alice2)
  const a2PostsSeen = await waitUntil(async () => {
    const posts = await official.getPostsOf(alice2.myPublicKeyHex)
    return posts.some((p) => p.texto === 'post-alice2-1') && posts.some((p) => p.texto === 'post-alice2-2')
  })
  const officialSeesAlice2 = await official.getPostsOf(alice2.myPublicKeyHex)
  console.log('SCENARIO B — Official sees BOTH Alice2 posts?', a2PostsSeen)
  console.log('  official.getPostsOf(Alice2) →', (officialSeesAlice2 || []).map((p) => p.texto))

  // Profile name too (profile page shows name from getProfileOf)
  const a2ProfileSeen = await waitUntil(async () => {
    const p = await official.getProfile(alice2.myPublicKeyHex)
    return p && p.nome === 'Alice2'
  })
  console.log('SCENARIO B — Official sees Alice2 profile name?', a2ProfileSeen)

  await official.stop().catch(() => {})
  await alice2.stop().catch(() => {})
  await bob2.stop().catch(() => {})
  await testnet.destroy().catch(() => {})

  const ok = aPosts && bobSeesAlicePosts.some((p) => p.texto === 'post-alice-1') &&
    autoFollowed && officialHasFollower && a2PostsSeen && a2ProfileSeen

  console.log('\nRESULT:', ok ? 'PASS' : 'FAIL')
  process.exit(ok ? 0 : 1)
})().catch((err) => {
  console.error('TEST ERROR:', err)
  process.exit(1)
})
