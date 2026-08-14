'use strict'

// ====================================================================
// Test of the "new user with an old imported key" bug:
//
// A) Importing an identity WITHOUT a seeder and canceling (stopping the node)
//    must NOT leave the `corestore` folder in the user's directory — otherwise
//    the next start would treat the user as established and create a new
//    profile with the imported key (the reported bug).
//    Also verifies that the temporary recovery folder is removed and that the
//    `recovered.json` marker is NOT written.
//
// B) Importing an identity WITH a seeder recovers the data and ONLY THEN
//    promotes the temporary storage to `corestore`, writes the marker and
//    reopens the core for writing (a new post works).
// ====================================================================

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const createTestnet = require('hyperdht/testnet')
const { P2PNode } = require('../src/p2p-node')
const { isRecovered } = require('../src/user-data')

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

;(async () => {
  const testnet = await createTestnet(3)
  const results = {}

  // ============ A) Import without a seeder and cancel ============
  const importDir = tmpDir('import-cancel')
  const abandoned = new P2PNode({ dataDir: importDir, swarmOpts: { dht: testnet.createNode() } })
  await abandoned.start({ recovery: true })
  await new Promise((resolve) => setTimeout(resolve, 1200))
  const wasWaiting = abandoned.lifecycleState === 'recovery'
  await abandoned.stop() // simulates the "cancel" button

  results.noCorestore = !fs.existsSync(path.join(importDir, 'corestore'))
  results.tempCleaned = !fs.existsSync(path.join(importDir, 'corestore.recovery'))
  results.identityPreserved = fs.existsSync(path.join(importDir, 'identity.json'))
  results.notMarked = !isRecovered(importDir)

  // ============ B) Import and recover from a seeder ============
  const sourceDir = tmpDir('import-source')
  const seederDir = tmpDir('import-seeder')
  const restoredDir = tmpDir('import-restored')
  const source = new P2PNode({ dataDir: sourceDir, swarmOpts: { dht: testnet.createNode() } })
  const seeder = new P2PNode({ dataDir: seederDir, swarmOpts: { dht: testnet.createNode() } })
  await source.start()
  await seeder.start()
  await source.updateMyProfile({ nome: 'Conta Recuperável' })
  await source.publishPost({ tipo: 'texto', texto: 'post que deve voltar' })
  await seeder.follow(source.myPublicKeyHex)

  const sourceLength = source.myCore.length
  // Waits for the seeder to download the source's full history (pattern from test-identity-recovery).
  const seeded = await waitUntil(() =>
    seeder.followed.has(source.myPublicKeyHex) &&
    seeder.followed.get(source.myPublicKeyHex).core.length >= sourceLength
  )
  if (seeded) {
    await seeder.followed.get(source.myPublicKeyHex).core.download({ start: 0, end: sourceLength }).done()
  }
  await source.stop()

  fs.copyFileSync(path.join(sourceDir, 'identity.json'), path.join(restoredDir, 'identity.json'))
  const restored = new P2PNode({ dataDir: restoredDir, swarmOpts: { dht: testnet.createNode() } })
  await restored.start({ recovery: true })
  // Do NOT use `await restored.recoveryPromise` directly (it can wait forever if
  // the seeder is offline): wait for recovery to finish with a timeout.
  const recovered = await waitUntil(() => restored.lifecycleState === 'ready', { timeout: 20000 })
  if (!recovered) await restored.stop().catch(() => {})

  results.corestorePromoted = fs.existsSync(path.join(restoredDir, 'corestore'))
  results.tempPromoted = !fs.existsSync(path.join(restoredDir, 'corestore.recovery'))
  results.marked = isRecovered(restoredDir)

  let profileRecovered = false
  let postRecovered = false
  let postAfterRecovery = false
  if (recovered) {
    const profile = await restored.getMyProfile()
    const posts = await restored.getPostsOf(restored.myPublicKeyHex)
    profileRecovered = !!profile && profile.nome === 'Conta Recuperável'
    postRecovered = posts.some((p) => p.texto === 'post que deve voltar')
    const created = await restored.publishPost({ tipo: 'texto', texto: 'post depois da recuperação' })
    postAfterRecovery = created.texto === 'post depois da recuperação'
  }
  results.profileRecovered = profileRecovered
  results.postRecovered = postRecovered
  results.postAfterRecovery = postAfterRecovery

  console.log('A) No seeder: stayed in recovery?', wasWaiting)
  console.log('A) corestore NOT created before recovery?', results.noCorestore)
  console.log('A) temporary folder removed on stop?', results.tempCleaned)
  console.log('A) identity.json preserved?', results.identityPreserved)
  console.log('A) marker NOT written?', results.notMarked)
  console.log('B) Seeder synced the source?', seeded)
  console.log('B) Recovery completed?', recovered)
  console.log('B) corestore promoted only after recovery?', results.corestorePromoted && results.tempPromoted)
  console.log('B) marker written?', results.marked)
  console.log('B) profile recovered?', results.profileRecovered)
  console.log('B) post recovered?', results.postRecovered)
  console.log('B) write after recovery?', results.postAfterRecovery)

  const ok =
    results.noCorestore && results.tempCleaned && results.identityPreserved && results.notMarked &&
    seeded && recovered && results.corestorePromoted && results.tempPromoted && results.marked &&
    results.profileRecovered && results.postRecovered && results.postAfterRecovery
  console.log('\nRESULT:', ok ? 'PASS' : 'FAIL')

  await restored.stop().catch(() => {})
  await seeder.stop().catch(() => {})
  await testnet.destroy()
  process.exit(ok ? 0 : 1)
})().catch((error) => {
  console.error('TEST ERROR:', error)
  process.exit(1)
})
