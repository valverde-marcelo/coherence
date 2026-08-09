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
  const testnet = await createTestnet(2)
  const dataDir = tmpDir('stop-race')
  const friend = new P2PNode({ dataDir: tmpDir('stop-race-friend'), swarmOpts: { dht: testnet.createNode() } })
  let node = new P2PNode({ dataDir, swarmOpts: { dht: testnet.createNode() } })

  await friend.start()
  await node.start()
  await node.publishPost({ tipo: 'texto', texto: 'post antes do restart' })
  await node.follow(friend.myPublicKeyHex)

  const statusRead = node.getFollowingList()
  const stop = node.stop()
  let statusError = null
  try {
    await statusRead
  } catch (error) {
    statusError = error
  }
  await stop

  node = new P2PNode({ dataDir, swarmOpts: { dht: testnet.createNode() } })
  await node.start()
  const restoredKey = node.myPublicKeyHex
  const post = await node.publishPost({ tipo: 'texto', texto: 'primeiro post depois do restore' })

  const ok = !statusError || statusError.code !== 'SESSION_CLOSED'
  const restoredPost = post.texto === 'primeiro post depois do restore' && post.autor === restoredKey
  console.log('Leitura concorrente não produziu SESSION_CLOSED?', ok)
  console.log('Primeiro post após reabrir foi publicado?', restoredPost)

  await node.stop()
  await friend.stop()
  await testnet.destroy()

  const passed = ok && restoredPost
  console.log('\nRESULTADO:', passed ? 'PASSOU' : 'FALHOU')
  process.exit(passed ? 0 : 1)
})().catch((err) => {
  console.error('ERRO NO TESTE:', err)
  process.exit(1)
})