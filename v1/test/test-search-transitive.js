'use strict'

// =====================================================================
// Busca TRANSITIVA de usuários pelo grafo de follows.
//
// Cenário: Alice → Bob → Carol → Dave
//   (Alice segue Bob, Bob segue Carol, Carol segue Dave)
//
// A partir de Alice deve ser possível localizar os outros usuários, pois há
// um ponto em comum: Bob.followList=[Carol] (local na Alice) e, abrindo o
// core da Carol, Carol.followList=[Dave].
//
//   - Alice acha Bob    (grau 1, seguindo)
//   - Alice acha Carol  (grau 2, via Bob)
//   - Alice acha Dave   (grau 3, via Carol)
//
// Uso: node test/test-search-transitive.js
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

    // Cadeia: Alice segue Bob, Bob segue Carol, Carol segue Dave
    await bob.follow(carol.myPublicKeyHex)
    await carol.follow(dave.myPublicKeyHex)
    await alice.follow(bob.myPublicKeyHex)

    // Alice acha Carol (grau 2, via Bob) — tenta com retry (conexões P2P)
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

    // Detalhes (depth/via) — BFS: Carol em grau 2 via Bob; Dave em grau 3 via Carol
    const carolResults = await alice.searchUsers('Carol')
    const carolHit = carolResults.find((r) => r.publicKeyHex === carol.myPublicKeyHex)
    console.log('Carol:', carolHit ? `depth=${carolHit.depth} via=${(carolHit.via || '').slice(0, 8)}` : 'n/a')

    const daveResults = await alice.searchUsers('Dave')
    const daveHit = daveResults.find((r) => r.publicKeyHex === dave.myPublicKeyHex)
    console.log('Dave:', daveHit ? `depth=${daveHit.depth} via=${(daveHit.via || '').slice(0, 8)}` : 'n/a')

    // DAVE também deve encontrar os outros (travessia ao CONTRÁRIO):
    // Dave → Carol (seguidora) → seguidores da Carol=[Bob] → seguidores do Bob=[Alice].
    // Depende de a Carol ter registrado o Bob e o Bob ter registrado a Alice.
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

    // Também casa por bio e por prefixo de chave
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
