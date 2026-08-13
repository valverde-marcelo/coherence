'use strict'

// =====================================================================
// TRANSITIVE user search over the follow graph.
//
// Scenario: Alice → Bob → Carol → Dave
//   (Alice follows Bob, Bob follows Carol, Carol follows Dave)
//
// From Alice it must be possible to locate the other users, since there is
// a common point: Bob.followList=[Carol] (local on Alice) and, opening
// Carol's core, Carol.followList=[Dave].
//
//   - Alice finds Bob    (degree 1, following)
//   - Alice finds Carol  (degree 2, via Bob)
//   - Alice finds Dave   (degree 3, via Carol)
//
// Usage: node test/test-search-transitive.js
// =====================================================================

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const createTestnet = require('hyperdht/testnet')
const { P2PNode } = require('../src/p2p-node')

function tmpDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name + '-'))
}

async function waitUntil(check, { timeout = 30000, interval = 200 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await check()) return true
    await new Promise((r) => setTimeout(r, interval))
  }
  return false
}

;(async () => {
  const testnet = await createTestnet(8)
  const alice = new P2PNode({ dataDir: tmpDir('st-alice'), swarmOpts: { dht: testnet.createNode() } })
  const bob = new P2PNode({ dataDir: tmpDir('st-bob'), swarmOpts: { dht: testnet.createNode() } })
  const carol = new P2PNode({ dataDir: tmpDir('st-carol'), swarmOpts: { dht: testnet.createNode() } })
  const dave = new P2PNode({ dataDir: tmpDir('st-dave'), swarmOpts: { dht: testnet.createNode() } })

  try {
    await alice.start()
    await bob.start()
    await carol.start()
    await dave.start()

    await alice.updateMyProfile({ nome: 'Alice', bio: 'local' })
    await bob.updateMyProfile({ nome: 'Bob', bio: 'remoto 1' })
    await carol.updateMyProfile({ nome: 'Carol', bio: 'remota 2' })
    await dave.updateMyProfile({ nome: 'Dave', bio: 'remoto 3' })

    // Chain: Alice follows Bob, Bob follows Carol, Carol follows Dave
    await bob.follow(carol.myPublicKeyHex)
    await carol.follow(dave.myPublicKeyHex)
    await alice.follow(bob.myPublicKeyHex)

    // Alice finds Carol (degree 2, via Bob) — tries with retry (P2P connections)
    const foundCarol = await waitUntil(async () => {
      const results = await alice.searchUsers('Carol')
      return results.some((r) => r.publicKeyHex === carol.myPublicKeyHex)
    }, { timeout: 40000 })
    console.log('Alice achou Carol?', foundCarol)

    // Alice acha Dave (grau 3, via Carol)
    const foundDave = await waitUntil(async () => {
      const results = await alice.searchUsers('Dave')
      return results.some((r) => r.publicKeyHex === dave.myPublicKeyHex)
    }, { timeout: 40000 })
    console.log('Alice achou Dave?', foundDave)

    // Details (depth/via) — BFS: Carol at degree 2 via Bob; Dave at degree 3 via Carol
    const carolResults = await alice.searchUsers('Carol')
    const carolHit = carolResults.find((r) => r.publicKeyHex === carol.myPublicKeyHex)
    console.log('Carol:', carolHit ? `depth=${carolHit.depth} via=${(carolHit.via || '').slice(0, 8)}` : 'n/a')

    const daveResults = await alice.searchUsers('Dave')
    const daveHit = daveResults.find((r) => r.publicKeyHex === dave.myPublicKeyHex)
    console.log('Dave:', daveHit ? `depth=${daveHit.depth} via=${(daveHit.via || '').slice(0, 8)}` : 'n/a')

    // DAVE must also find the others (REVERSE traversal):
    // Dave → Carol (follower) → Carol's followers=[Bob] → Bob's followers=[Alice].
    // Depends on Carol having registered Bob and Bob having registered Alice.
    const carolRecordedBob = await waitUntil(async () => {
      const followers = await carol.getFollowers()
      return followers.some((f) => f.publicKeyHex === bob.myPublicKeyHex)
    }, { timeout: 30000 })
    console.log('Carol registrou Bob?', carolRecordedBob)

    const bobRecordedAlice = await waitUntil(async () => {
      const followers = await bob.getFollowers()
      return followers.some((f) => f.publicKeyHex === alice.myPublicKeyHex)
    }, { timeout: 30000 })
    console.log('Bob registrou Alice?', bobRecordedAlice)

    const daveFindsBob = await waitUntil(async () => {
      const results = await dave.searchUsers('Bob')
      return results.some((r) => r.publicKeyHex === bob.myPublicKeyHex)
    }, { timeout: 40000 })
    console.log('Dave achou Bob?', daveFindsBob)

    const daveFindsAlice = await waitUntil(async () => {
      const results = await dave.searchUsers('Alice')
      return results.some((r) => r.publicKeyHex === alice.myPublicKeyHex)
    }, { timeout: 40000 })
    console.log('Dave achou Alice?', daveFindsAlice)

    // Also matches by bio and by key prefix
    const byBio = await alice.searchUsers('remota')
    console.log('Busca por bio "remota":', byBio.map((r) => r.nome).join(', ') || '(nenhum)')
    const byKey = await alice.searchUsers(carol.myPublicKeyHex.slice(0, 10))
    console.log('Busca por prefixo de chave:', byKey.map((r) => r.nome).join(', ') || '(nenhum)')

    const ok = foundCarol && foundDave &&
      carolHit && carolHit.depth === 2 && carolHit.via === bob.myPublicKeyHex &&
      daveHit && daveHit.depth === 3 && daveHit.via === carol.myPublicKeyHex &&
      byBio.some((r) => r.publicKeyHex === carol.myPublicKeyHex) &&
      byKey.some((r) => r.publicKeyHex === carol.myPublicKeyHex) &&
      carolRecordedBob && bobRecordedAlice && daveFindsBob && daveFindsAlice

    console.log('\nRESULTADO:', ok ? 'PASSOU' : 'FALHOU')
    process.exit(ok ? 0 : 1)
  } finally {
    await alice.stop().catch(() => {})
    await bob.stop().catch(() => {})
    await carol.stop().catch(() => {})
    await dave.stop().catch(() => {})
    await testnet.destroy().catch(() => {})
  }
})().catch((err) => {
  console.error('ERRO NO TESTE:', err)
  process.exit(1)
})
