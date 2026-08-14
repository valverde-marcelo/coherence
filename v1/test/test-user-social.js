'use strict'

// =====================================================================
// Tests the SOCIAL GRAPH of a user (getUserSocial) — the data behind the
// "Seguindo / Seguidores" counts and lists on the profile page.
//
// Scenario:
//   Alice, Bob and Carol on the same testnet.
//   Bob follows Carol; Alice follows Bob.
//
// Expected:
//   - Bob's social:  following=[Carol], followers=[Alice]
//   - Alice's social: following=[Bob]
//   - getUserSocial reads the FOLLOWED user's own bee (followList from the
//     profile + followers!<pubkey> records), not the viewer's own graph.
//
// Usage: node test/test-user-social.js
// =====================================================================

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const createTestnet = require('hyperdht/testnet')
const { P2PNode } = require('../src/p2p-node')

function tmpDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name + '-'))
}

async function waitUntil(check, { timeout = 15000, interval = 200 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await check()) return true
    await new Promise((r) => setTimeout(r, interval))
  }
  return false
}

;(async () => {
  const testnet = await createTestnet(4)
  const alice = new P2PNode({ dataDir: tmpDir('us-alice'), swarmOpts: { dht: testnet.createNode() } })
  const bob = new P2PNode({ dataDir: tmpDir('us-bob'), swarmOpts: { dht: testnet.createNode() } })
  const carol = new P2PNode({ dataDir: tmpDir('us-carol'), swarmOpts: { dht: testnet.createNode() } })

  await alice.start()
  await bob.start()
  await carol.start()

  await alice.updateMyProfile({ nome: 'Alice' })
  await bob.updateMyProfile({ nome: 'Bob' })
  await carol.updateMyProfile({ nome: 'Carol' })

  // Bob follows Carol
  await bob.follow(carol.myPublicKeyHex)

  // Bob's following comes from the profile followList (deterministic)
  const bobFollowingCarol = await waitUntil(async () => {
    const social = await bob.getUserSocial(bob.myPublicKeyHex)
    return social && social.following.includes(carol.myPublicKeyHex)
  })
  console.log('Bob seguindo Carol (via getUserSocial)?', bobFollowingCarol)

  // Alice follows Bob → Bob registers Alice as a follower over the network
  await alice.follow(bob.myPublicKeyHex)
  const bobHasAlice = await waitUntil(async () => {
    const followers = await bob.getFollowers()
    return followers.some((f) => f.publicKeyHex === alice.myPublicKeyHex)
  })
  console.log('Bob registrou Alice como seguidora?', bobHasAlice)

  // Now Bob's social graph should have following=[Carol] and followers=[Alice]
  let bobSocial = null
  await waitUntil(async () => {
    bobSocial = await bob.getUserSocial(bob.myPublicKeyHex)
    return bobSocial && bobSocial.following.includes(carol.myPublicKeyHex) && bobSocial.followers.includes(alice.myPublicKeyHex)
  })
  console.log('getUserSocial(Bob) → following:', (bobSocial && bobSocial.following.map((k) => k.slice(0, 8))) || '(null)')
  console.log('getUserSocial(Bob) → followers:', (bobSocial && bobSocial.followers.map((k) => k.slice(0, 8))) || '(null)')

  // Reading Bob's social from ALICE's node (the profile-page use case: A views B)
  let aliceSeesBob = null
  await waitUntil(async () => {
    aliceSeesBob = await alice.getUserSocial(bob.myPublicKeyHex)
    return aliceSeesBob && aliceSeesBob.following.length >= 1 && aliceSeesBob.followers.length >= 1
  })
  console.log('Alice lê getUserSocial(Bob) → following:', (aliceSeesBob && aliceSeesBob.following.map((k) => k.slice(0, 8))) || '(null)')
  console.log('Alice lê getUserSocial(Bob) → followers:', (aliceSeesBob && aliceSeesBob.followers.map((k) => k.slice(0, 8))) || '(null)')

  // Alice's own social
  const aliceSocial = await alice.getUserSocial(alice.myPublicKeyHex)
  console.log('getUserSocial(Alice) → following:', aliceSocial.following.map((k) => k.slice(0, 8)))
  const aliceFollowsBob = aliceSocial.following.includes(bob.myPublicKeyHex)

  const ok = bobFollowingCarol && bobHasAlice &&
    !!bobSocial && bobSocial.following.includes(carol.myPublicKeyHex) && bobSocial.followers.includes(alice.myPublicKeyHex) &&
    !!aliceSeesBob && aliceSeesBob.following.includes(carol.myPublicKeyHex) && aliceSeesBob.followers.includes(alice.myPublicKeyHex) &&
    aliceFollowsBob

  await alice.stop().catch(() => {})
  await bob.stop().catch(() => {})
  await carol.stop().catch(() => {})
  await testnet.destroy().catch(() => {})

  console.log('\nRESULTADO:', ok ? 'PASSOU' : 'FALHOU')
  process.exit(ok ? 0 : 1)
})().catch((err) => {
  console.error('ERRO NO TESTE:', err)
  process.exit(1)
})
