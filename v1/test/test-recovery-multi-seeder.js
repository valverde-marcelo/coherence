'use strict'

// =====================================================================
// Identity recovery with MULTIPLE seeders + edge cases of the
// "incomplete seeder" detection (per-peer diagnostics + robustness):
//
//   (a) complete seeder + partial seeder        -> recovers
//   (b) two partial seeders (union covers)      -> recovers
//   (c) only partial seeders (with a gap)       -> stalled, does NOT recover
//   (d) partial first (stall), then complete arrives -> recovers
//
// Usage: node test/test-recovery-multi-seeder.js
//
// NOTE: the source core GROWS when the seeders send follow-requests
// (the source registers followers = new blocks). The setup waits for the
// source size to STABILIZE before downloading the seeders' ranges.
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

/** Node with a short recovery download window (fast tests). */
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

/** Waits for the source core to stop growing (follow-requests settle). */
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
 * Brings up the source (profile + posts), connects the seeders, waits for the
 * source to stabilize and downloads each seeder's range up to the FINAL size.
 * @param {P2PNode} source
 * @param {Array<{node: P2PNode, getRange: (n:number)=> {start:number,end:number}}>} seeders
 * @returns {Promise<{finalLength: number, seeders: Array}>} final size and seeders (with `.entry`)
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

/** Indexes of the blocks the core has locally. */
async function blocksOf(core, length) {
  const have = []
  for (let i = 0; i < length; i++) {
    if (await core.has(i)) have.push(i)
  }
  return have
}

/** Checks a property over a seeder's blocks (fails if it doesn't hold). */
async function assertBlocks(entry, length, predicate, label) {
  const have = await blocksOf(entry.core, length)
  console.log(`  ${label}: blocks=[${have.join(',')}]`)
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

// (a) complete seeder + partial seeder -> recovers
async function scenarioA(testnet) {
  const source = makeNode(testnet, tmpDir('msA-source'))
  const partial = makeNode(testnet, tmpDir('msA-partial'))
  const complete = makeNode(testnet, tmpDir('msA-complete'))
  const restored = makeNode(testnet, tmpDir('msA-restored'))
  try {
    const seeders = [
      { node: partial, getRange: (n) => ({ start: 1, end: n }) },   // without block 0
      { node: complete, getRange: (n) => ({ start: 0, end: n }) }    // complete
    ]
    const { finalLength } = await setupSourceWithSeeders(source, seeders)
    console.log('[A] final length:', finalLength)
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

// (b) two partial seeders whose union covers all blocks -> recovers
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
    console.log('[B] final length:', finalLength, '| mid:', mid)
    // the union covers everything: p1 has the start, p2 has the middle and the end
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

// (c) only partial seeders (with a gap) -> stalled and does NOT recover
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
    console.log('[C] final length:', finalLength, '| mid:', mid)
    // the `mid` block is missing in BOTH -> gap on the network
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
    // Diagnostics: all connected peers must appear as INCOMPLETE
    const peersOk = stalledInfo && Array.isArray(stalledInfo.peers) &&
      stalledInfo.peers.length > 0 && stalledInfo.peers.every((p) => !p.complete)
    console.log('[C] states:', states.join(' -> '))
    console.log('[C] stalled payload:', stalledInfo ? JSON.stringify(stalledInfo) : 'n/a')
    return stalled && !recovered && peersOk
  } finally {
    await stopAll([source, p1, p2, restored])
  }
}

// (d) partial seeder first (stall) and then a complete one joins -> recovers
async function scenarioD(testnet) {
  const source = makeNode(testnet, tmpDir('msD-source'))
  const partial = makeNode(testnet, tmpDir('msD-partial'))
  const restored = makeNode(testnet, tmpDir('msD-restored'))
  let complete2 = null
  try {
    // only the partial stays online during recovery (without block 0)
    const seeders = [
      { node: partial, getRange: (n) => ({ start: 1, end: n }) }
    ]
    const { finalLength } = await setupSourceWithSeeders(source, seeders)
    console.log('[D] final length:', finalLength)
    await assertBlocks(seeders[0].entry, finalLength, (h) => !h.includes(0) && h.length === finalLength - 1, '[D] parcial')

    // the source goes offline, but the data stays preserved in source.dataDir
    await source.stop()

    copyIdentity(source, restored)
    const states = trackRecovery(restored)
    await restored.start({ recovery: true })

    // 1) only the partial seeder -> must stall (stalled)
    const stalled = await waitUntil(() => states.includes('stalled'), { timeout: 70000, interval: 400 })
    console.log('[D] stalled with partial?', stalled)
    if (!stalled) return false

    // 2) the owner's device reconnects: the source is stopped (lock released),
    //    so a new node opens the SAME dataDir (complete data on disk) and
    //    returns to the network -> peer-add resets the detection and recovery
    //    proceeds.
    //    (You can't COPY the corestore: rocksdb-native validates the device
    //    file and rejects copies with "Invalid device file, was modified".)
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
    console.log(`\n=== Scenario ${name} ===`)
    const testnet = await createTestnet(6)
    try {
      const ok = await fn(testnet)
      results[name] = ok
      console.log(`[${name}] RESULT:`, ok ? 'PASS' : 'FAIL')
    } catch (err) {
      results[name] = false
      console.error(`[${name}] ERROR:`, err.message)
      console.error(err.stack)
    } finally {
      await testnet.destroy().catch(() => {})
    }
  }
  await run('A', scenarioA)
  await run('B', scenarioB)
  await run('C', scenarioC)
  await run('D', scenarioD)
  console.log('\n=== SUMMARY ===')
  for (const [name, ok] of Object.entries(results)) console.log(`  ${name}: ${ok ? 'PASS' : 'FAIL'}`)
  process.exit(Object.values(results).every(Boolean) ? 0 : 1)
})().catch((err) => {
  console.error('TEST ERROR:', err)
  process.exit(1)
})
