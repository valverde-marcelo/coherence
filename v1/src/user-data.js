'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

function publicKeyHexFromIdentity(identity) {
  if (typeof identity.coreKey === 'string' && /^[0-9a-f]{64}$/i.test(identity.coreKey)) {
    return identity.coreKey.toLowerCase()
  }
  const publicKey = crypto.createPublicKey(identity.publicKey)
  return publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex')
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
  readIdentity,
  userDataDir,
  listUserKeys,
  parseUserKeyArg
}