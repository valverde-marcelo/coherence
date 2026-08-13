'use strict'

// ====================================================================
// Identity: reuses EXACTLY the same strategy from the original prototype
// (app-p2p.js) to generate/load the Ed25519 keypair via node:crypto, and
// adds the conversion to the format used by Hypercore
// ({ publicKey: 32 bytes, secretKey: 64 bytes }).
//
// Why reuse the same key? Because the user's "real" identity is the
// Ed25519 keypair itself (it signs everything). The format of the public
// address you share with friends changes (see README/NOTAS-OPCAO-B.md),
// but the private key stays the same — no user loses or needs to recreate
// their cryptographic identity because of this migration.
// ====================================================================

const fs = require('node:fs')
const path = require('node:path')
const nodeCrypto = require('node:crypto')

function rawPublicKeyBytes(publicKeyObject) {
  // Node does not expose format:'buffer' for Ed25519 keys — we export
  // as JWK (RFC 8037) and decode the "x" field (base64url).
  const jwk = publicKeyObject.export({ format: 'jwk' })
  return Buffer.from(jwk.x, 'base64url')
}

function rawSeedBytes(privateKeyObject) {
  const jwk = privateKeyObject.export({ format: 'jwk' })
  return Buffer.from(jwk.d, 'base64url')
}

/**
 * Converts a node:crypto keypair (PEM, Ed25519) into the format used by the
 * Hypercore ecosystem libs (libsodium): secretKey = seed(32) + publicKey(32).
 */
function toHypercoreKeyPair(publicKeyObject, privateKeyObject) {
  const publicKey = rawPublicKeyBytes(publicKeyObject)
  const seed = rawSeedBytes(privateKeyObject)
  const secretKey = Buffer.concat([seed, publicKey])
  return { publicKey, secretKey }
}

/**
 * Loads the identity from disk or generates a new one on first run.
 * Keeps the same file format (identity.json with PEM) as the original
 * prototype, so an existing identity.json keeps working.
 */
function loadOrCreateIdentity(identityFile) {
  let pem

  if (fs.existsSync(identityFile)) {
    pem = JSON.parse(fs.readFileSync(identityFile, 'utf8'))
  } else {
    const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync('ed25519')
    pem = {
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' })
    }
    fs.mkdirSync(path.dirname(identityFile), { recursive: true })
    fs.writeFileSync(identityFile, JSON.stringify(pem, null, 2))
  }

  const publicKeyObject = nodeCrypto.createPublicKey(pem.publicKey)
  const privateKeyObject = nodeCrypto.createPrivateKey(pem.privateKey)
  const keyPair = toHypercoreKeyPair(publicKeyObject, privateKeyObject)

  return {
    keyPair,               // { publicKey, secretKey } — use to open your own core in Corestore
    coreKey: typeof pem.coreKey === 'string' ? pem.coreKey : null,
    publicKeyObject,       // node:crypto KeyObject, in case you need to sign something outside Hypercore
    privateKeyObject
  }
}

function saveCoreKey(identityFile, coreKey) {
  const identity = JSON.parse(fs.readFileSync(identityFile, 'utf8'))
  identity.coreKey = Buffer.from(coreKey).toString('hex')
  fs.writeFileSync(identityFile, JSON.stringify(identity, null, 2))
}

module.exports = { loadOrCreateIdentity, saveCoreKey, toHypercoreKeyPair }
