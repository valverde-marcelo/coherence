'use strict'

// =====================================================================
// Reproduces: visiting the profile of a user you DON'T follow (and who is
// not your follower) shows no posts (and no profile name).
//
// Scenario:
//   Alice and Bob on the same testnet, NOT following each other.
//   Bob has a profile ('Bob') and publishes a post.
//   Alice calls getProfileOf(Bob) and getPostsOf(Bob) directly — the same
//   path the profile page uses for suggested users / arbitrary users.
//
// Expected (after fix): Alice sees Bob's name and Bob's post.
//   Before the fix: getProfileOf returns null and getPostsOf returns [].
//
// Usage: node test/test-profile-posts-unknown-user.js
// =====================================================================

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const createTestnet = require('hyperdht/testnet')
const { P2PNode } = require('../src/p2p-node')

function tmpDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name + '-'))
}

async function waitUntil(check, { timeout = 20000, interval = 250 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await check()) return true
    await new Promise((r) => setTimeout(r, interval))
  }
  return false
}

;(async () => {
  const testnet = await createTestnet(4)
  const alice = new P2PNode({ dataDir: tmpDir('pp-alice'), swarmOpts: { dht: testnet.createNode() } })
  const bob = new P2PNode({ dataDir: tmpDir('pp-bob'), swarmOpts: { dht: testnet.createNode() } })

  await alice.start()
  await bob.start()

  await bob.updateMyProfile({ nome: 'Bob' })
  await bob.publishPost({ tipo: 'texto', texto: 'post do Bob' })

  // Sanity: Bob sees his own profile and post.
  const bobOwnProfile = await bob.getProfile(bob.myPublicKeyHex)
  const bobOwnPosts = await bob.getPostsOf(bob.myPublicKeyHex)
  console.log("Bob's own profile nome:", bobOwnProfile && bobOwnProfile.nome)
  console.log("Bob's own posts count:", bobOwnPosts.length)

  // ALICE does NOT follow Bob and Bob does NOT follow Alice — she just
  // opens his profile (like clicking "ver perfil" on a suggested user).
  // The core is opened on demand when reading the profile/posts.
  const profileSeen = await waitUntil(async () => {
    const p = await alice.getProfile(bob.myPublicKeyHex)
    return p && p.nome === 'Bob'
  })
  const postsSeen = await waitUntil(async () => {
    const posts = await alice.getPostsOf(bob.myPublicKeyHex)
    return posts.some((p) => p.texto === 'post do Bob')
  })
  const profile = await alice.getProfile(bob.myPublicKeyHex)
  const posts = await alice.getPostsOf(bob.myPublicKeyHex)
  console.log('Alice sees Bob profile?', profileSeen, '→ nome:', profile && profile.nome)
  console.log('Alice sees Bob posts?', postsSeen, '→ posts:', posts.length)
  if (posts.length) console.log('  first post:', posts[0].texto)

  const ok = profileSeen && postsSeen && !!profile && profile.nome === 'Bob' &&
    posts.some((p) => p.texto === 'post do Bob')

  await alice.stop().catch(() => {})
  await bob.stop().catch(() => {})
  await testnet.destroy().catch(() => {})

  console.log('\nRESULT:', ok ? 'PASS' : 'FAIL')
  process.exit(ok ? 0 : 1)
})().catch((err) => {
  console.error('TEST ERROR:', err)
  process.exit(1)
})
