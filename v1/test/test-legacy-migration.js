'use strict'

// Tests the migration of the legacy layout (identity.json + corestore at the
// dataRoot root) to the per-key folder. Verifies two critical rules:
//
//  1. The migrated legacy user with a local corestore receives the
//     `recovered.json` marker — without it the app would enter an eternal
//     "recovery" ("looking for seeders on the network", "peers on the network: 0")
//     ignoring the local data.
//  2. The migration NEVER moves other local users' folders (64-hex folders)
//     — otherwise the other users would "disappear" from the start-all listing.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  migrateLegacyData,
  isRecovered,
  isEstablished,
  listUserKeys
} = require('../src/user-data')

function tmpRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name + '-'))
}

function makeLegacyIdentity(dir) {
  fs.mkdirSync(dir, { recursive: true })
  const identity = {
    publicKey: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAf8jOfQt+/Y29u2mB4bvZ0sKRlpjjovoJQdkrrVJWhTg=\n-----END PUBLIC KEY-----\n',
    privateKey: '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEILqN9Wbbp7UOpKIzbUJpgwhZHma0bt9f4KxQatXxnIRf\n-----END PRIVATE KEY-----\n',
    coreKey: 'a9885418b1c62a495f50e3a03ef7fb5ccf72339f1471d8894eecad218c0cff5f'
  }
  fs.writeFileSync(path.join(dir, 'identity.json'), JSON.stringify(identity, null, 2))
}

;(async () => {
  const results = {}

  // ---- Case A: legacy with local corestore + another per-key user at the root
  const rootA = tmpRoot('legacy-migrate-A')
  makeLegacyIdentity(rootA)
  fs.mkdirSync(path.join(rootA, 'corestore'), { recursive: true })
  fs.writeFileSync(path.join(rootA, 'corestore', 'CORESTORE'), 'x')
  // Another local user (64-hex folder) that must NOT be moved.
  const otherKey = 'bf4470ee990388235613535d7ca97967d0b77e0b27a60681bcafc7f2083aa4d7'
  fs.mkdirSync(path.join(rootA, otherKey), { recursive: true })
  fs.writeFileSync(path.join(rootA, otherKey, 'identity.json'), '{}')

  const migratedA = migrateLegacyData(rootA)
  const targetA = path.join(rootA, 'a9885418b1c62a495f50e3a03ef7fb5ccf72339f1471d8894eecad218c0cff5f')

  results.A_migrated = migratedA === true
  results.A_identityMoved = fs.existsSync(path.join(targetA, 'identity.json'))
  results.A_corestoreMoved = fs.existsSync(path.join(targetA, 'corestore', 'CORESTORE'))
  results.A_markerWritten = isRecovered(targetA)
  results.A_established = isEstablished(targetA)
  results.A_otherUserKept = fs.existsSync(path.join(rootA, otherKey, 'identity.json'))
  results.A_otherUserNotInside = !fs.existsSync(path.join(targetA, otherKey))
  results.A_rootClean = !fs.existsSync(path.join(rootA, 'identity.json'))
  results.A_listedKeys = listUserKeys(rootA).sort().join(',')

  // ---- Case B: legacy WITHOUT corestore (pending import) → does NOT mark
  const rootB = tmpRoot('legacy-migrate-B')
  makeLegacyIdentity(rootB)
  const migratedB = migrateLegacyData(rootB)
  const targetB = path.join(rootB, 'a9885418b1c62a495f50e3a03ef7fb5ccf72339f1471d8894eecad218c0cff5f')
  results.B_migrated = migratedB === true
  results.B_noMarker = !isRecovered(targetB)
  results.B_notEstablished = !isEstablished(targetB)

  // ---- Case C: root without identity.json → nothing to migrate
  const rootC = tmpRoot('legacy-migrate-C')
  fs.mkdirSync(path.join(rootC, 'deadbeef'), { recursive: true })
  results.C_noop = migrateLegacyData(rootC) === false

  console.log('A) legacy with corestore migrated:', results.A_migrated)
  console.log('A) identity.json moved:', results.A_identityMoved)
  console.log('A) corestore moved:', results.A_corestoreMoved)
  console.log('A) recovered.json written:', results.A_markerWritten)
  console.log('A) isEstablished:', results.A_established)
  console.log('A) other user preserved in root:', results.A_otherUserKept)
  console.log('A) other user NOT moved inside:', results.A_otherUserNotInside)
  console.log('A) root clean:', results.A_rootClean)
  console.log('A) keys listed:', results.A_listedKeys)
  console.log('B) legacy without corestore migrated:', results.B_migrated)
  console.log('B) no marker:', results.B_noMarker)
  console.log('B) not established:', results.B_notEstablished)
  console.log('C) without identity.json, noop:', results.C_noop)

  const ok = results.A_migrated &&
    results.A_identityMoved && results.A_corestoreMoved && results.A_markerWritten &&
    results.A_established &&
    results.A_otherUserKept && results.A_otherUserNotInside && results.A_rootClean &&
    results.A_listedKeys === 'a9885418b1c62a495f50e3a03ef7fb5ccf72339f1471d8894eecad218c0cff5f,bf4470ee990388235613535d7ca97967d0b77e0b27a60681bcafc7f2083aa4d7' &&
    results.B_migrated && results.B_noMarker && results.B_notEstablished &&
    results.C_noop

  console.log('\nRESULT:', ok ? 'PASS' : 'FAIL')
  process.exit(ok ? 0 : 1)
})().catch((err) => {
  console.error('TEST ERROR:', err)
  process.exit(1)
})
