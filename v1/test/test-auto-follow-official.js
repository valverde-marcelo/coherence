'use strict'

// =====================================================================
// AUTO-FOLLOW of the official Coherence user on brand-new accounts.
//
// Scenario:
//   - An "official" node (O) is online.
//   - A brand-new user (A) is started with autoFollowKey = O's key.
//
// It must verify that:
//   (a) A automatically follows O (followList contains O's key)
//   (b) O registers A as a follower (follow-request delivered)
//   (c) RESTARTING A (existing profile) does NOT re-follow/duplicate
//   (d) after A unfollows O, a further restart does NOT re-add O
//
// Usage: node test/test-auto-follow-official.js
// =====================================================================

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const createTestnet = require('hyperdht/testnet')
const { P2PNode } = require('../src/p2p-node')

function tmpDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name + '-'))
}

async function waitUntil(check, { timeout = 30000, interval = 200 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await check()) return true
    await new Promise((r) => setTimeout(r, interval))
  }
  return false
}

;(async () => {
  const testnet = await createTestnet(8)
  const official = new P2PNode({ dataDir: tmpDir('af-official'), swarmOpts: { dht: testnet.createNode() } })

  let aDataDir = tmpDir('af-newuser')
  const newUser = (autoFollowKey) => new P2PNode({
    dataDir: aDataDir,
    swarmOpts: { dht: testnet.createNode() },
    autoFollowKey
  })

  try {
    await official.start()
    await official.updateMyProfile({ nome: 'Coherence Oficial', bio: 'official account' })

    // ---- (a) brand-new user auto-follows the official -------------------
    const a1 = newUser(official.myPublicKeyHex)
    await a1.start()
    await a1.updateMyProfile({ nome: 'Novato' })

    const autoFollowed = await waitUntil(async () => {
      const following = await a1.getFollowingList()
      return following.some((p) => p.publicKeyHex === official.myPublicKeyHex)
    }, { timeout: 40000 })
    console.log('(a) new user auto-followed official?', autoFollowed)

    // ---- (b) official registers the new user as follower ----------------
    const officialRecorded = await waitUntil(async () => {
      const followers = await official.getFollowers()
      return followers.some((f) => f.publicKeyHex === a1.myPublicKeyHex)
    }, { timeout: 40000 })
    console.log('(b) official registered new user as follower?', officialRecorded)

    // ---- (c) restart (existing profile) does not duplicate --------------
    await a1.stop().catch(() => {})
    const a2 = newUser(official.myPublicKeyHex)
    await a2.start()

    const restartKeepsOnce = await waitUntil(async () => {
      const following = await a2.getFollowingList()
      return following.filter((p) => p.publicKeyHex === official.myPublicKeyHex).length === 1
    }, { timeout: 40000 })
    const followersAfterRestart = await official.getFollowers()
    const followerCount = followersAfterRestart.filter((f) => f.publicKeyHex === a2.myPublicKeyHex).length
    console.log('(c) restart keeps official once in followList?', restartKeepsOnce, `(follower records: ${followerCount})`)

    // ---- (d) unfollow + restart does NOT re-add -------------------------
    await a2.unfollow(official.myPublicKeyHex)
    const unfollowed = !(await a2.getFollowingList()).some((p) => p.publicKeyHex === official.myPublicKeyHex)
    console.log('(d1) unfollow removed official?', unfollowed)

    await a2.stop().catch(() => {})
    const a3 = newUser(official.myPublicKeyHex)
    await a3.start()

    const noRefollow = await waitUntil(async () => {
      const following = await a3.getFollowingList()
      return !following.some((p) => p.publicKeyHex === official.myPublicKeyHex)
    }, { timeout: 20000 })
    console.log('(d2) restart after unfollow did NOT re-add official?', noRefollow)

    await a3.stop().catch(() => {})

    const ok = autoFollowed && officialRecorded && restartKeepsOnce && followerCount === 1 && unfollowed && noRefollow
    console.log('\nRESULT:', ok ? 'PASS' : 'FAIL')
    process.exit(ok ? 0 : 1)
  } finally {
    await official.stop().catch(() => {})
    await testnet.destroy().catch(() => {})
  }
})().catch((err) => {
  console.error('TEST ERROR:', err)
  process.exit(1)
})
