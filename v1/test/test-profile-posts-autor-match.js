'use strict'

// =====================================================================
// Reproduces: profile of a FOLLOWED user who HAS posts shows an empty
// posts area. The feed shows the posts, but the profile filters them out.
//
// Hypothesis to verify: in getPostsOf(), _postsFrom sets autor=pubKeyHex
// but the stored post value (e.value) OVERWRITES it with the owner's key
// (e.value.autor). If the owner's stored key differs from the key used to
// open the profile (casing/spacing), the renderer's
// `if (post.autor !== pubKeyHex) continue` filter drops every post.
//
// Usage: node test/test-profile-posts-autor-match.js
// =====================================================================

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const createTestnet = require('hyperdht/testnet')
const { P2PNode } = require('../src/p2p-node')

function tmpDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name + '-'))
}

async function waitUntil(check, { timeout = 25000, interval = 250 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await check()) return true
    await new Promise((r) => setTimeout(r, interval))
  }
  return false
}

;(async () => {
  const testnet = await createTestnet(4)

  const alice = new P2PNode({ dataDir: tmpDir('am-alice'), swarmOpts: { dht: testnet.createNode() } })
  const bob = new P2PNode({ dataDir: tmpDir('am-bob'), swarmOpts: { dht: testnet.createNode() } })

  await alice.start()
  await bob.start()
  await alice.updateMyProfile({ nome: 'Alice' })
  await bob.updateMyProfile({ nome: 'Bob' })

  await alice.publishPost({ tipo: 'texto', texto: 'post A' })
  await alice.publishPost({ tipo: 'texto', texto: 'post B' })

  // Bob follows Alice
  await bob.follow(alice.myPublicKeyHex)

  // Wait for Bob's copy to be complete
  await waitUntil(async () => {
    const posts = await bob.getPostsOf(alice.myPublicKeyHex)
    return posts.length >= 2
  })

  const aliceKey = alice.myPublicKeyHex
  const posts = await bob.getPostsOf(aliceKey)
  console.log('Alice key:', aliceKey)
  console.log('Bob followed key:', bob.followed.has(aliceKey) ? '(exact match)' : '(MISMATCH!)')
  console.log('getPostsOf(Alice) →', posts.length, 'posts')
  for (const p of posts) {
    console.log(`  seq=${p.seq} texto="${p.texto}" autor=${p.autor}`)
    console.log(`    autor === alice.myPublicKeyHex? ${p.autor === aliceKey}`)
    console.log(`    autor === aliceKey.toLowerCase()? ${p.autor === aliceKey.toLowerCase()}`)
  }

  // Simulate the renderer filter: showProfileView(aliceKey) → getPostsOf(aliceKey)
  const filtered = posts.filter((p) => p.autor === aliceKey)
  console.log('Renderer filter (autor === pubKeyHex) keeps:', filtered.length, 'of', posts.length)

  const ok = posts.length === 2 && filtered.length === 2 &&
    posts.every((p) => p.autor === aliceKey)

  await bob.stop().catch(() => {})
  await alice.stop().catch(() => {})
  await testnet.destroy().catch(() => {})

  console.log('\nRESULT:', ok ? 'PASS' : 'FAIL')
  process.exit(ok ? 0 : 1)
})().catch((err) => {
  console.error('TEST ERROR:', err)
  process.exit(1)
})
