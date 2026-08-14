'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const createTestnet = require('hyperdht/testnet')
const { P2PNode } = require('../src/p2p-node')

function tmpDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name + '-'))
}

async function waitUntil(check, { timeout = 12000, interval = 150 } = {}) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeout) {
    if (await check()) return true
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
  return false
}

;(async () => {
  const testnet = await createTestnet(4)
  const sourceDir = tmpDir('identity-recovery-source')
  const seederDir = tmpDir('identity-recovery-seeder')
  const restoredDir = tmpDir('identity-recovery-restored')
  const source = new P2PNode({ dataDir: sourceDir, swarmOpts: { dht: testnet.createNode() } })
  const seeder = new P2PNode({ dataDir: seederDir, swarmOpts: { dht: testnet.createNode() } })
  const restored = new P2PNode({
    dataDir: restoredDir,
    recoveryTimeoutMs: 12000,
    swarmOpts: { dht: testnet.createNode() }
  })

  await source.start()
  await seeder.start()
  await source.updateMyProfile({ nome: 'Fonte recuperável', bio: 'perfil preservado' })
  await source.publishPost({ tipo: 'texto', texto: 'post preservado pela rede' })
  await seeder.follow(source.myPublicKeyHex)

  const seeded = await waitUntil(async () => {
    const feed = await seeder.getFeed()
    return feed.some((post) => post.autor === source.myPublicKeyHex)
  })
  if (!seeded) throw new Error('Seeder não sincronizou o core da fonte.')

  const followerRecorded = await waitUntil(async () => {
    const followers = await source.getFollowers()
    return followers.some((follower) => follower.publicKeyHex === seeder.myPublicKeyHex)
  })
  if (!followerRecorded) throw new Error('A fonte não registrou o seeder como seguidor.')

  const sourceLength = source.myCore.length
  const seederHasFullHistory = await waitUntil(() =>
    seeder.followed.get(source.myPublicKeyHex).core.length >= sourceLength
  )
  if (!seederHasFullHistory) throw new Error('Seeder não baixou o histórico completo da fonte.')
  await seeder.followed.get(source.myPublicKeyHex).core.download({ start: 0, end: sourceLength }).done()

  fs.copyFileSync(path.join(sourceDir, 'identity.json'), path.join(restoredDir, 'identity.json'))
  await source.stop()

  await restored.start({ recovery: true })
  await restored.recoveryPromise

  const recovered = restored.lifecycleState === 'ready'
  const profile = recovered ? await restored.getMyProfile() : null
  const posts = recovered ? await restored.getPostsOf(restored.myPublicKeyHex) : []
  const followers = recovered ? await restored.getFollowers() : []
  const ok = recovered &&
    profile.nome === 'Fonte recuperável' &&
    profile.bio === 'perfil preservado' &&
    posts.some((post) => post.texto === 'post preservado pela rede') &&
    followers.some((follower) => follower.publicKeyHex === seeder.myPublicKeyHex)

  console.log('Seeder synced the source?', seeded)
  console.log('Restored identity entered ready?', recovered)
  console.log('Profile recovered?', profile && profile.nome === 'Fonte recuperável')
  console.log('Post recovered?', posts.some((post) => post.texto === 'post preservado pela rede'))
  console.log('Follower recovered?', followers.some((follower) => follower.publicKeyHex === seeder.myPublicKeyHex))
  console.log('\nRESULT:', ok ? 'PASS' : 'FAIL')

  await restored.stop()
  await seeder.stop()
  await testnet.destroy()
  process.exit(ok ? 0 : 1)
})().catch(async (error) => {
  console.error('TEST ERROR:', error)
  process.exit(1)
})
