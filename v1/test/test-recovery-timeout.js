'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const createTestnet = require('hyperdht/testnet')
const { P2PNode } = require('../src/p2p-node')

function tmpDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name + '-'))
}

;(async () => {
  const testnet = await createTestnet(1)
  const dataDir = tmpDir('recovery-timeout')
  const initial = new P2PNode({ dataDir, swarmOpts: { dht: testnet.createNode() } })
  await initial.start()
  const identityPath = path.join(dataDir, 'identity.json')
  await initial.stop()

  fs.rmSync(path.join(dataDir, 'corestore'), { recursive: true, force: true })
  const recovery = new P2PNode({
    dataDir,
    recoveryTimeoutMs: 1000,
    swarmOpts: { dht: testnet.createNode() }
  })
  await recovery.start({ recovery: true })
  await recovery.recoveryPromise
  const expired = recovery.lifecycleState === 'recovery-expired' && fs.existsSync(identityPath)
  await recovery.stop()

  fs.rmSync(path.join(dataDir, 'corestore'), { recursive: true, force: true })
  const fresh = new P2PNode({ dataDir, swarmOpts: { dht: testnet.createNode() } })
  await fresh.start()
  const post = await fresh.publishPost({ tipo: 'texto', texto: 'primeiro post depois do zero' })
  const startedFromZero = post.texto === 'primeiro post depois do zero'

  console.log('Recovery sem seeder expirou?', expired)
  console.log('Identity.json foi preservado?', fs.existsSync(identityPath))
  console.log('Primeiro post no novo core?', startedFromZero)
  console.log('\nRESULTADO:', expired && startedFromZero ? 'PASSOU' : 'FALHOU')

  await fresh.stop()
  await testnet.destroy()
  process.exit(expired && startedFromZero ? 0 : 1)
})().catch((error) => {
  console.error('ERRO NO TESTE:', error)
  process.exit(1)
})
