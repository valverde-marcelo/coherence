'use strict'

// =====================================================================
// Testa o ALVO do follow-request (Fix: targetKey).
//
// Cenário (reproduz o bug reportado):
//   A (Alice) limpa, B (Bob) limpo, C (Carol) limpa
//   B segue C
//   A segue B
//
// Comportamento esperado:
//   - B registra A como seguidora        (A segue B)           ✓
//   - C registra B como seguidor         (B segue C)           ✓
//   - C NÃO deve registrar A             (A não segue C)       ✓ (bug: A aparecia)
//
// O bug: Alice e Carol acabam no tópico do core de Bob (Alice porque segue
// Bob; Carol porque auto-carregou Bob como seguidor). Alice então envia o
// follow-request a TODOS os peers do core de Bob — incluindo Carol — e Carol
// registrava Alice sem verificar que o pedido era para ela.
//
// Uso: node test/test-follow-target.js
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

  // B segue C; A segue B
  await bob.follow(carol.myPublicKeyHex)
  await alice.follow(bob.myPublicKeyHex)

  // Bob registra Alice como seguidora (correto)
  const bobHasAlice = await waitUntil(async () => {
    const followers = await bob.getFollowers()
    return followers.some((f) => f.publicKeyHex === alice.myPublicKeyHex)
  }, { timeout: 15000 })
  console.log('Bob registrou Alice como seguidora?', bobHasAlice)

  // Carol registra Bob como seguidor (correto)
  const carolHasBob = await waitUntil(async () => {
    const followers = await carol.getFollowers()
    return followers.some((f) => f.publicKeyHex === bob.myPublicKeyHex)
  }, { timeout: 15000 })
  console.log('Carol registrou Bob como seguidor?', carolHasBob)

  // Garante a topologia do bug: Alice e Carol conectadas no core do Bob
  // (Carol entrou no tópico de Bob via auto-load de seguidor).
  const topology = await waitUntil(() => {
    const entry = alice.followed.get(bob.myPublicKeyHex)
    return entry && entry.core.peers.length >= 2
  }, { timeout: 15000 })
  console.log('Alice e Carol no tópico do core de Bob (topologia do bug)?', topology)

  // Espera um tempo para qualquer follow-request "vazado" chegar na Carol.
  await new Promise((r) => setTimeout(r, 4000))
  const carolFollowers = await carol.getFollowers()
  console.log('Seguidores da Carol:', carolFollowers.map((f) => f.publicKeyHex.slice(0, 12)).join(', ') || '(nenhum)')
  const carolHasAlice = carolFollowers.some((f) => f.publicKeyHex === alice.myPublicKeyHex)
  console.log('Carol registrou Alice (NÃO deveria)?', carolHasAlice)

  const ok = bobHasAlice && carolHasBob && topology && !carolHasAlice

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
