'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

function identityKeyHexFromIdentity(identity) {
  const publicKey = crypto.createPublicKey(identity.publicKey)
  return publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex')
}

/**
 * Canonical user public key: the coreKey (Hypercore key, which is the
 * shareable/replicated key — same as `myPublicKeyHex`) when present;
 * before the core exists (new user / import without coreKey), it falls
 * back to the identity key (Ed25519), which is what names the folder on
 * creation.
 */
function publicKeyHexFromIdentity(identity) {
  if (typeof identity.coreKey === 'string' && /^[0-9a-f]{64}$/i.test(identity.coreKey)) {
    return identity.coreKey.toLowerCase()
  }
  return identityKeyHexFromIdentity(identity)
}

/**
 * Checks whether an identity matches a key passed in --user-key.
 * A user's folder may legitimately have been named in two ways:
 *   1. by the identity key (Ed25519) — user created locally, or
 *      imported before a coreKey existed in the file;
 *   2. by the coreKey — imported identity whose file already carried a coreKey.
 * Accepts either one, so existing folders are never rejected.
 */
function identityMatchesKey(identity, requestedKey) {
  if (!identity) return false
  if (publicKeyHexFromIdentity(identity) === requestedKey) return true
  try {
    return identityKeyHexFromIdentity(identity) === requestedKey
  } catch {
    return false
  }
}

function readIdentity(identityFile) {
  try {
    return JSON.parse(fs.readFileSync(identityFile, 'utf8'))
  } catch {
    return null
  }
}

function userDataDir(dataRoot, publicKeyHex) {
  return path.join(dataRoot, publicKeyHex)
}

/**
 * Migrates a legacy user (identity.json + corestore at the dataRoot ROOT,
 * pre-multi-user layout) into its own folder, named after the canonical
 * public key.
 *
 * Rules:
 *  - Only moves legacy files from the root (identity.json, corestore, settings
 *    etc.). NEVER moves other local users' folders (folders named with a
 *    64-character hex key) — otherwise they would be "swallowed" and the other
 *    users would disappear from the listing.
 *  - If the legacy user has a sound local corestore, writes the `recovered.json`
 *    marker. Without it, the app would treat the account as a pending import
 *    and enter "recovery", ignoring local data and staying forever on
 *    "looking for seeders on the network".
 */
function migrateLegacyData(dataRoot) {
  const legacyIdentityFile = path.join(dataRoot, 'identity.json')
  const identity = readIdentity(legacyIdentityFile)
  if (!identity) return false
  const targetDir = userDataDir(dataRoot, publicKeyHexFromIdentity(identity))
  fs.mkdirSync(targetDir, { recursive: true })
  for (const entry of fs.readdirSync(dataRoot, { withFileTypes: true })) {
    if (entry.name === path.basename(targetDir)) continue
    // Never move other local users' folders.
    if (entry.isDirectory() && /^[0-9a-f]{64}$/i.test(entry.name)) continue
    fs.renameSync(path.join(dataRoot, entry.name), path.join(targetDir, entry.name))
  }
  // The legacy layout only existed for ESTABLISHED users (the old app had no
  // pending import). With a local corestore, mark it as recovered.
  if (fs.existsSync(path.join(targetDir, 'corestore'))) {
    writeRecoveredMarker(targetDir)
  }
  return true
}

function recoveredMarkerFile(dataDir) {
  return path.join(dataDir, 'recovered.json')
}

/**
 * A user is only considered "established/recovered" when this marker exists.
 * It is written ONLY after the imported identity was actually recovered from
 * the network (or when a new/normal user is created). Without the marker, an
 * orphan `corestore` folder (e.g. from an interrupted/canceled recovery) can
 * NEVER be promoted to a "user" — the app goes back to the recovery flow.
 */
function isRecovered(dataDir) {
  return fs.existsSync(recoveredMarkerFile(dataDir))
}

function writeRecoveredMarker(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(recoveredMarkerFile(dataDir), JSON.stringify({ recoveredAt: Date.now() }, null, 2))
}

/**
 * A user is "established" when they can start with local data, without
 * needing network recovery: they have the recovered.json marker OR a sound
 * local corestore.
 *
 * Pending/canceled imports NEVER create the `corestore` folder (during
 * recovery the storage stays in `corestore.recovery`, removed on cancel).
 * Therefore, the presence of `corestore` is a reliable sign of established
 * data — even if the marker was lost (e.g. sync/OneDrive conflict).
 */
function isEstablished(dataDir) {
  return isRecovered(dataDir) || fs.existsSync(path.join(dataDir, 'corestore'))
}

function listUserKeys(dataRoot) {
  if (!fs.existsSync(dataRoot)) return []
  return fs.readdirSync(dataRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[0-9a-f]{64}$/i.test(entry.name))
    .map((entry) => entry.name.toLowerCase())
}

function parseUserKeyArg(argv = process.argv, env = process.env) {
  const index = argv.indexOf('--user-key')
  const value = index >= 0
    ? argv[index + 1]
    : argv.find((arg) => arg.startsWith('--user-key='))?.slice(11) || env.npm_config_user_key
  if (value === undefined) return null
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error('--user-key precisa ser uma chave pública hexadecimal de 64 caracteres.')
  return value.toLowerCase()
}

module.exports = {
  publicKeyHexFromIdentity,
  identityKeyHexFromIdentity,
  identityMatchesKey,
  readIdentity,
  userDataDir,
  migrateLegacyData,
  recoveredMarkerFile,
  isRecovered,
  writeRecoveredMarker,
  isEstablished,
  listUserKeys,
  parseUserKeyArg
}