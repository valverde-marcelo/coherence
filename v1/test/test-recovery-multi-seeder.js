'use strict'

// =====================================================================
// Recuperação de identidade com MÚLTIPLOS seeders + casos de borda da
// detecção de "seeder incompleto" (diagnóstico por peer + robustez):
//
//   (a) seeder completo + seeder parcial      -> recupera
//   (b) dois seeders parciais (união cobre)   -> recupera
//   (c) só seeders parciais (com lacuna)      -> stalled, NÃO recupera
//   (d) parcial primeiro (stall), depois completo chega -> recupera
//
// Uso: node test/test-recovery-multi-seeder.js
//
// ATENÇÃO: o core da fonte CRESCE quando os seeders enviam follow-requests
// (a fonte registra seguidores = novos blocos). O setup espera o tamanho da
// fonte ESTABILIZAR antes de baixar os intervalos dos seeders.
// =====================================================================

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const createTestnet = require('hyperdht/testnet')
const { P2PNode } = require('../src/p2p-node')

function tmpDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name + '-'))
}

async function waitUntil(check, { timeout = 20000, interval = 150 } = {}) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeout) {
    if (await check()) return true
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
  return false
}

/** Nó com janela de download de recuperação curta (testes rápidos). */
function makeNode(testnet, dir, extra = {}) {
  return new P2PNode({
    dataDir: dir,
    recoveryTimeoutMs: 20000,
    recoveryDownloadTimeoutMs: 3000,
    swarmOpts: { dht: testnet.createNode() },
    ...extra
  })
}

async function stopAll(nodes) {
  await Promise.all(nodes.map((n) => n.stop().catch(() => {})))
}

/** Espera o core da fonte parar de crescer (follow-requests assentarem). */
async function waitForStableLength(source) {
  let prev = -1
  let stable = 0
  while (stable < 2) {
    const cur = source.myCore.length
    if (cur === prev && cur > 0) stable++
    else stable = 0
    prev = cur
    await new Promise((resolve) => setTimeout(resolve, 1200))
  }
  return prev
}

/**
 * Sobe a fonte (perfil + posts), conecta os seeders, espera a fonte
 * estabilizar e baixa o intervalo de cada seeder até o tamanho FINAL.
 * @param {P2PNode} source
 * @param {Array<{node: P2PNode, getRange: (n:number)=> {start:number,end:number}}>} seeders
 * @returns {Promise<{finalLength: number, seeders: Array}>} tamanho final e seeders (com `.entry`)
 */
async function setupSourceWithSeeders(source, seeders) {
  await source.start()
  await source.updateMyProfile({ nome: 'Fonte', bio: 'multi-seeder' })
  for (let i = 1; i <= 3; i++) {
    await source.publishPost({ tipo: 'texto', texto: 'post ' + i })
  }
  for (const s of seeders) {
    await s.node.start()
    s.entry = await s.node._loadFollowerData(source.myPublicKeyHex)
  }
  const finalLength = await waitForStableLength(source)
  for (const s of seeders) {
    const { start, end } = s.getRange(finalLength)
    const core = s.entry.core
    await waitUntil(async () => {
      await core.update({ wait: true })
      return core.length >= finalLength
    }, { timeout: 15000 })
    await core.download({ start, end }).done()
  }
  return { finalLength, seeders }
}

/** Índices dos blocos que o core tem localmente. */
async function blocksOf(core, length) {
  const have = []
  for (let i = 0; i < length; i++) {
    if (await core.has(i)) have.push(i)
  }
  return have
}

/** Verifica uma propriedade sobre os blocos de um seeder (falha se não bater). */
async function assertBlocks(entry, length, predicate, label) {
  const have = await blocksOf(entry.core, length)
  console.log(`  ${label}: blocos=[${have.join(',')}]`)
  if (!predicate(have)) throw new Error(`${label} com blocos inesperados: [${have.join(',')}]`)
}

function copyIdentity(source, restored) {
  fs.copyFileSync(path.join(source.dataDir, 'identity.json'), path.join(restored.dataDir, 'identity.json'))
}

function trackRecovery(restored) {
  const states = []
  restored.on('recovery-updated', (s) => { states.push(s.state) })
  return states
}

// (a) seeder completo + seeder parcial -> recupera
async function scenarioA(testnet) {
  const source = makeNode(testnet, tmpDir('msA-source'))
  const partial = makeNode(testnet, tmpDir('msA-partial'))
  const complete = makeNode(testnet, tmpDir('msA-complete'))
  const restored = makeNode(testnet, tmpDir('msA-restored'))
  try {
    const seeders = [
      { node: partial, getRange: (n) => ({ start: 1, end: n }) },   // sem o bloco 0
      { node: complete, getRange: (n) => ({ start: 0, end: n }) }    // completo
    ]
    const { finalLength } = await setupSourceWithSeeders(source, seeders)
    console.log('[A] length final:', finalLength)
    await assertBlocks(seeders[1].entry, finalLength, (h) => h.length === finalLength, '[A] completo')
    await assertBlocks(seeders[0].entry, finalLength, (h) => !h.includes(0) && h.length === finalLength - 1, '[A] parcial')
    await source.stop()

    copyIdentity(source, restored)
    const states = trackRecovery(restored)
    await restored.start({ recovery: true })
    const recovered = await waitUntil(() => restored.lifecycleState === 'ready', { timeout: 60000, interval: 400 })
    console.log('[A] states:', states.join(' -> '))
    return recovered
  } finally {
    await stopAll([source, partial, complete, restored])
  }
}

// (b) dois seeders parciais cuja união cobre todos os blocos -> recupera
async function scenarioB(testnet) {
  const source = makeNode(testnet, tmpDir('msB-source'))
  const p1 = makeNode(testnet, tmpDir('msB-p1'))
  const p2 = makeNode(testnet, tmpDir('msB-p2'))
  const restored = makeNode(testnet, tmpDir('msB-restored'))
  try {
    const seeders = [
      { node: p1, getRange: (n) => ({ start: 0, end: Math.floor(n / 2) }) },
      { node: p2, getRange: (n) => ({ start: Math.floor(n / 2), end: n }) }
    ]
    const { finalLength } = await setupSourceWithSeeders(source, seeders)
    const mid = Math.floor(finalLength / 2)
    console.log('[B] length final:', finalLength, '| mid:', mid)
    // união cobre tudo: p1 tem o início, p2 tem o meio e o fim
    await assertBlocks(seeders[0].entry, finalLength, (h) => h.includes(0) && !h.includes(mid), '[B] p1')
    await assertBlocks(seeders[1].entry, finalLength, (h) => h.includes(mid) && h.includes(finalLength - 1), '[B] p2')
    await source.stop()

    copyIdentity(source, restored)
    const states = trackRecovery(restored)
    await restored.start({ recovery: true })
    const recovered = await waitUntil(() => restored.lifecycleState === 'ready', { timeout: 60000, interval: 400 })
    console.log('[B] states:', states.join(' -> '))
    return recovered
  } finally {
    await stopAll([source, p1, p2, restored])
  }
}

// (c) só seeders parciais (com lacuna) -> stalled e NÃO recupera
async function scenarioC(testnet) {
  const source = makeNode(testnet, tmpDir('msC-source'))
  const p1 = makeNode(testnet, tmpDir('msC-p1'))
  const p2 = makeNode(testnet, tmpDir('msC-p2'))
  const restored = makeNode(testnet, tmpDir('msC-restored'))
  try {
    const seeders = [
      { node: p1, getRange: (n) => ({ start: 0, end: Math.floor(n / 2) }) },
      { node: p2, getRange: (n) => ({ start: Math.floor(n / 2) + 1, end: n }) }
    ]
    const { finalLength } = await setupSourceWithSeeders(source, seeders)
    const mid = Math.floor(finalLength / 2)
    console.log('[C] length final:', finalLength, '| mid:', mid)
    // o bloco `mid` falta em AMBOS -> lacuna na rede
    await assertBlocks(seeders[0].entry, finalLength, (h) => h.includes(0) && !h.includes(mid), '[C] p1')
    await assertBlocks(seeders[1].entry, finalLength, (h) => h.includes(finalLength - 1) && !h.includes(mid), '[C] p2')
    await source.stop()

    copyIdentity(source, restored)
    const states = []
    let stalledInfo = null
    restored.on('recovery-updated', (s) => {
      states.push(s.state)
      if (s.state === 'stalled') stalledInfo = s
    })
    await restored.start({ recovery: true })
    const stalled = await waitUntil(() => states.includes('stalled'), { timeout: 70000, interval: 400 })
    const recovered = restored.lifecycleState === 'ready'
    // Diagnóstico: todos os peers conectados devem aparecer como INCOMPLETOS
    const peersOk = stalledInfo && Array.isArray(stalledInfo.peers) &&
      stalledInfo.peers.length > 0 && stalledInfo.peers.every((p) => !p.complete)
    console.log('[C] states:', states.join(' -> '))
    console.log('[C] stalled payload:', stalledInfo ? JSON.stringify(stalledInfo) : 'n/a')
    return stalled && !recovered && peersOk
  } finally {
    await stopAll([source, p1, p2, restored])
  }
}

// (d) seeder parcial primeiro (stall) e depois entra um completo -> recupera
async function scenarioD(testnet) {
  const source = makeNode(testnet, tmpDir('msD-source'))
  const partial = makeNode(testnet, tmpDir('msD-partial'))
  const restored = makeNode(testnet, tmpDir('msD-restored'))
  let complete2 = null
  try {
    // só o parcial fica online durante a recuperação (sem o bloco 0)
    const seeders = [
      { node: partial, getRange: (n) => ({ start: 1, end: n }) }
    ]
    const { finalLength } = await setupSourceWithSeeders(source, seeders)
    console.log('[D] length final:', finalLength)
    await assertBlocks(seeders[0].entry, finalLength, (h) => !h.includes(0) && h.length === finalLength - 1, '[D] parcial')

    // a fonte sai do ar, mas os dados ficam preservados em source.dataDir
    await source.stop()

    copyIdentity(source, restored)
    const states = trackRecovery(restored)
    await restored.start({ recovery: true })

    // 1) só o seeder parcial -> deve travar (stalled)
    const stalled = await waitUntil(() => states.includes('stalled'), { timeout: 70000, interval: 400 })
    console.log('[D] stalled com parcial?', stalled)
    if (!stalled) return false

    // 2) o dispositivo do dono reconecta: a fonte está parada (lock liberado),
    //    então um novo nó abre o MESMO dataDir (dados completos em disco) e
    //    volta à rede -> o peer-add reseta a detecção e a recuperação prossegue.
    //    (Não dá para COPIAR o corestore: o rocksdb-native valida o arquivo do
    //    dispositivo e rejeita cópias com "Invalid device file, was modified".)
    complete2 = makeNode(testnet, source.dataDir)
    await complete2.start()
    const recovered = await waitUntil(() => restored.lifecycleState === 'ready', { timeout: 60000, interval: 400 })
    console.log('[D] states:', states.join(' -> '))
    return recovered
  } finally {
    await stopAll([source, partial, restored].concat(complete2 ? [complete2] : []))
  }
}

;(async () => {
  const only = process.env.SCENARIO
  const results = {}
  const run = async (name, fn) => {
    if (only && only !== name) return
    console.log(`\n=== Cenário ${name} ===`)
    const testnet = await createTestnet(6)
    try {
      const ok = await fn(testnet)
      results[name] = ok
      console.log(`[${name}] RESULTADO:`, ok ? 'PASSOU' : 'FALHOU')
    } catch (err) {
      results[name] = false
      console.error(`[${name}] ERRO:`, err.message)
      console.error(err.stack)
    } finally {
      await testnet.destroy().catch(() => {})
    }
  }
  await run('A', scenarioA)
  await run('B', scenarioB)
  await run('C', scenarioC)
  await run('D', scenarioD)
  console.log('\n=== RESUMO ===')
  for (const [name, ok] of Object.entries(results)) console.log(`  ${name}: ${ok ? 'PASSOU' : 'FALHOU'}`)
  process.exit(Object.values(results).every(Boolean) ? 0 : 1)
})().catch((err) => {
  console.error('ERRO NO TESTE:', err)
  process.exit(1)
})
