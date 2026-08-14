'use strict'

// =====================================================================
// Tests the TARGET of the follow-request (Fix: targetKey).
//
// Scenario (reproduces the reported bug):
//   A (Alice) clean, B (Bob) clean, C (Carol) clean
//   B follows C
//   A follows B
//
// Expected behavior:
//   - B registers A as follower         (A follows B)           ✓
//   - C registers B as follower         (B follows C)           ✓
//   - C must NOT register A             (A doesn't follow C)    ✓ (bug: A appeared)
//
// The bug: Alice and Carol end up in Bob's core topic (Alice because she follows
// Bob; Carol because she auto-loaded Bob as a follower). Alice then sends the
// follow-request to ALL peers in Bob's core — including Carol — and Carol
// registered Alice without checking that the request was meant for her.
//
// Usage: node test/test-follow-target.js
// =====================================================================

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const createTestnet = require('hyperdht/testnet')
const { P2PNode } = require('../src/p2p-node')

function tmpDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name + '-'))
}

async function waitUntil(check, { timeout = 12000, interval = 150 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await check()) return true
    await new Promise((r) => setTimeout(r, interval))
  }
  return false
}

;(async () => {
  const testnet = await createTestnet(4)
  const alice = new P2PNode({ dataDir: tmpDir('ft-alice'), swarmOpts: { dht: testnet.createNode() } })
  const bob = new P2PNode({ dataDir: tmpDir('ft-bob'), swarmOpts: { dht: testnet.createNode() } })
  const carol = new P2PNode({ dataDir: tmpDir('ft-carol'), swarmOpts: { dht: testnet.createNode() } })

  await alice.start()
  await bob.start()
  await carol.start()

  await alice.updateMyProfile({ nome: 'Alice' })
  await bob.updateMyProfile({ nome: 'Bob' })
  await carol.updateMyProfile({ nome: 'Carol' })

  console.log('Alice:', alice.myPublicKeyHex.slice(0, 16))
  console.log('Bob  :', bob.myPublicKeyHex.slice(0, 16))
  console.log('Carol:', carol.myPublicKeyHex.slice(0, 16))

  // B follows C; A follows B
  await bob.follow(carol.myPublicKeyHex)
  await alice.follow(bob.myPublicKeyHex)

  // Bob registers Alice as a follower (correct)
  const bobHasAlice = await waitUntil(async () => {
    const followers = await bob.getFollowers()
    return followers.some((f) => f.publicKeyHex === alice.myPublicKeyHex)
  }, { timeout: 15000 })
  console.log('Bob registered Alice as a follower?', bobHasAlice)

  // Carol registers Bob as a follower (correct)
  const carolHasBob = await waitUntil(async () => {
    const followers = await carol.getFollowers()
    return followers.some((f) => f.publicKeyHex === bob.myPublicKeyHex)
  }, { timeout: 15000 })
  console.log('Carol registered Bob as a follower?', carolHasBob)

  // Ensures the bug's topology: Alice and Carol connected in Bob's core
  // (Carol joined Bob's topic via follower auto-load).
  const topology = await waitUntil(() => {
    const entry = alice.followed.get(bob.myPublicKeyHex)
    return entry && entry.core.peers.length >= 2
  }, { timeout: 15000 })
  console.log('Alice and Carol on Bob\'s core topic (bug topology)?', topology)

  // Waits a while for any "leaked" follow-request to reach Carol.
  await new Promise((r) => setTimeout(r, 4000))
  const carolFollowers = await carol.getFollowers()
  console.log('Carol followers:', carolFollowers.map((f) => f.publicKeyHex.slice(0, 12)).join(', ') || '(none)')
  const carolHasAlice = carolFollowers.some((f) => f.publicKeyHex === alice.myPublicKeyHex)
  console.log('Carol registered Alice (should NOT)?', carolHasAlice)

  const ok = bobHasAlice && carolHasBob && topology && !carolHasAlice

  await alice.stop().catch(() => {})
  await bob.stop().catch(() => {})
  await carol.stop().catch(() => {})
  await testnet.destroy().catch(() => {})

  console.log('\nRESULT:', ok ? 'PASS' : 'FAIL')
  process.exit(ok ? 0 : 1)
})().catch((err) => {
  console.error('TEST ERROR:', err)
  process.exit(1)
})
