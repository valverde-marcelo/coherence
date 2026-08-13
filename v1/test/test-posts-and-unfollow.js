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
  const node = new P2PNode({ dataDir: tmpDir('imgtest'), swarmOpts: { dht: testnet.createNode() } })
  await node.start()

  // valid image post
  const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  const post = await node.publishPost({ tipo: 'imagem', imagem: { dataBase64: tinyPngBase64, mime: 'image/png' } })
  console.log('post de imagem aceito:', post.tipo === 'imagem' && post.imagem.mime === 'image/png')

  // an image that is too large must be rejected
  let rejected = false
  try {
    await node.publishPost({ tipo: 'imagem', imagem: { dataBase64: 'A'.repeat(500 * 1024), mime: 'image/png' } })
  } catch (err) {
    rejected = /limite/.test(err.message)
  }
  console.log('imagem grande demais foi rejeitada:', rejected)

  // a post without a valid type must fail
  let rejectedTipo = false
  try {
    await node.publishPost({ tipo: 'video', texto: 'x' })
  } catch (err) {
    rejectedTipo = true
  }
  console.log("tipo inválido ('video') foi rejeitado:", rejectedTipo)

  // following yourself must fail
  let cantFollowSelf = false
  try {
    await node.follow(node.myPublicKeyHex)
  } catch (err) {
    cantFollowSelf = true
  }
  console.log('seguir a si mesmo foi bloqueado:', cantFollowSelf)

  // follow + unfollow of an arbitrary hex key (no need to be online)
  const fakeKey = '11'.repeat(32)
  await node.follow(fakeKey)
  const followingAfter = (await node.getMyProfile()).followList
  console.log('follow adicionou à lista:', followingAfter.includes(fakeKey))

  await node.unfollow(fakeKey)
  const followingAfterUnfollow = (await node.getMyProfile()).followList
  console.log('unfollow removeu da lista:', !followingAfterUnfollow.includes(fakeKey))

  const ok = post.tipo === 'imagem' && rejected && rejectedTipo && cantFollowSelf &&
    followingAfter.includes(fakeKey) && !followingAfterUnfollow.includes(fakeKey)

  await node.stop()
  await testnet.destroy()

  console.log('\nRESULTADO:', ok ? 'PASSOU' : 'FALHOU')
  process.exit(ok ? 0 : 1)
})().catch((err) => {
  console.error('ERRO NO TESTE:', err)
  process.exit(1)
})
