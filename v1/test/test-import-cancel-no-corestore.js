'use strict'

// ====================================================================
// Teste do bug de "novo usuário com chave antiga importada":
//
// A) Importar uma identidade SEM seeder e cancelar (parar o nó) NÃO pode
//    deixar a pasta `corestore` no diretório do usuário — senão o próximo
//    início trataria o usuário como estabelecido e criaria um perfil novo
//    com a chave importada (o bug relatado).
//    Verifica também que a pasta temporária de recuperação é removida e
//    que o marcador `recovered.json` NÃO é gravado.
//
// B) Importar uma identidade COM seeder recupera os dados e SÓ ENTÃO
//    promove o storage temporário para `corestore`, grava o marcador e
//    reabre o core para escrita (novo post funciona).
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

  // ============ A) Importar sem seeder e cancelar ============
  const importDir = tmpDir('import-cancel')
  const abandoned = new P2PNode({ dataDir: importDir, swarmOpts: { dht: testnet.createNode() } })
  await abandoned.start({ recovery: true })
  await new Promise((resolve) => setTimeout(resolve, 1200))
  const wasWaiting = abandoned.lifecycleState === 'recovery'
  await abandoned.stop() // simula o botão "cancelar"

  results.noCorestore = !fs.existsSync(path.join(importDir, 'corestore'))
  results.tempCleaned = !fs.existsSync(path.join(importDir, 'corestore.recovery'))
  results.identityPreserved = fs.existsSync(path.join(importDir, 'identity.json'))
  results.notMarked = !isRecovered(importDir)

  // ============ B) Importar e recuperar de um seeder ============
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
  // Espera o seeder baixar o histórico completo da fonte (padrão do test-identity-recovery).
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
  // NÃO usar `await restored.recoveryPromise` diretamente (ele pode ficar aguardando
  // para sempre se o seeder estiver offline): espera com timeout a recuperação concluir.
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

  console.log('A) Sem seeder: ficou em recovery?', wasWaiting)
  console.log('A) corestore NÃO criado antes da recuperação?', results.noCorestore)
  console.log('A) pasta temporária removida ao parar?', results.tempCleaned)
  console.log('A) identity.json preservado?', results.identityPreserved)
  console.log('A) marcador NÃO gravado?', results.notMarked)
  console.log('B) Seeder sincronizou a fonte?', seeded)
  console.log('B) Recovery concluído?', recovered)
  console.log('B) corestore promovido só após recuperar?', results.corestorePromoted && results.tempPromoted)
  console.log('B) marcador gravado?', results.marked)
  console.log('B) perfil recuperado?', results.profileRecovered)
  console.log('B) post recuperado?', results.postRecovered)
  console.log('B) escrita pós-recuperação?', results.postAfterRecovery)

  const ok =
    results.noCorestore && results.tempCleaned && results.identityPreserved && results.notMarked &&
    seeded && recovered && results.corestorePromoted && results.tempPromoted && results.marked &&
    results.profileRecovered && results.postRecovered && results.postAfterRecovery
  console.log('\nRESULTADO:', ok ? 'PASSOU' : 'FALHOU')

  await restored.stop().catch(() => {})
  await seeder.stop().catch(() => {})
  await testnet.destroy()
  process.exit(ok ? 0 : 1)
})().catch((error) => {
  console.error('ERRO NO TESTE:', error)
  process.exit(1)
})
