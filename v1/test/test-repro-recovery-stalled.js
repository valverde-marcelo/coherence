'use strict'

// Verifica o Fix 2 (detecção de seeder incompleto):
//   1. A publica perfil + posts
//   2. B carrega o core de A mas baixa SÓ PARTE dos blocos (simula um seeder
//      parcial, como os criados antes do fix do _ensureFullDownload)
//   3. A para (offline)
//   4. O nó restaurado tenta recuperar de B -> NÃO deve travar em silêncio;
//      deve emitir recovery-updated com state 'stalled'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const createTestnet = require('hyperdht/testnet')
const { P2PNode } = require('../src/p2p-node')

function tmpDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name + '-'))
}

async function waitUntil(check, { timeout = 15000, interval = 150 } = {}) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeout) {
    if (await check()) return true
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
  return false
}

async function main() {
  const testnet = await createTestnet(4)
  const sourceDir = tmpDir('stall-source')
  const seederDir = tmpDir('stall-seeder')
  const restoredDir = tmpDir('stall-restored')

  const source = new P2PNode({ dataDir: sourceDir, swarmOpts: { dht: testnet.createNode() } })
  const seeder = new P2PNode({ dataDir: seederDir, swarmOpts: { dht: testnet.createNode() } })
  const restored = new P2PNode({
    dataDir: restoredDir,
    recoveryTimeoutMs: 20000,
    swarmOpts: { dht: testnet.createNode() }
  })

  await source.start()
  await seeder.start()

  await source.updateMyProfile({ nome: 'Fonte parcial', bio: 'bio' })
  await source.publishPost({ tipo: 'texto', texto: 'post parcial 1' })
  await source.publishPost({ tipo: 'texto', texto: 'post parcial 2' })
  const sourceLength = source.myCore.length

  // B entra no tópico de A (como seeder) mas baixa SÓ os blocos 2..len-1 (parcial)
  const entry = await seeder._loadFollowerData(source.myPublicKeyHex)
  const bCore = entry.core
  bCore.on('download', (i) => console.log(`[B:download-de-A] block=${i}`))
  await waitUntil(async () => bCore.update({ wait: true }).then(() => bCore.length >= sourceLength), { timeout: 15000 })
  console.log('[setup] B core length:', bCore.length, '| source length:', sourceLength)
  const dl = bCore.download({ start: 2, end: bCore.length })
  await dl.done()
  for (let i = 0; i < sourceLength; i++) {
    console.log(`[setup] B tem bloco ${i} de A?`, await bCore.has(i))
  }

  // A para (offline)
  await source.stop()

  // Restored tenta recuperar
  fs.copyFileSync(path.join(sourceDir, 'identity.json'), path.join(restoredDir, 'identity.json'))

  let states = []
  restored.on('recovery-updated', (s) => {
    states.push(s.state)
    console.log('[recovery-updated]', JSON.stringify(s))
  })

  await restored.start({ recovery: true })

  const stalled = await waitUntil(() => states.includes('stalled'), { timeout: 80000, interval: 500 })
  const recovered = restored.lifecycleState === 'ready'

  console.log('\n[result] Emitiu state "stalled"?', stalled)
  console.log('[result] Entrou em ready (não deveria)?', recovered)
  console.log('[result] states:', states.join(' -> '))
  console.log('\nRESULTADO:', stalled && !recovered ? 'PASSOU' : 'FALHOU')

  await restored.stop().catch(() => {})
  await seeder.stop().catch(() => {})
  await testnet.destroy()
  process.exit(stalled && !recovered ? 0 : 1)
}

main().catch((e) => { console.error('ERRO:', e); process.exit(1) })
